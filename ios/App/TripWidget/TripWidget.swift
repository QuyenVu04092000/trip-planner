import WidgetKit
import SwiftUI
import AppIntents
import OSLog
import ImageIO

private let log = Logger(subsystem: "com.webcashglobal.tripmemo.TripWidgetExtension", category: "Widget")

// MARK: - Data model

struct WidgetTripData: Codable, Sendable {
    var tripId: String
    var tripName: String
    var tripEmoji: String
    var startDate: String?
    var endDate: String?
    var daysLeft: Int
    var status: String
    var todayActivities: [String]
    var schedule: [String: [String]]   // "yyyy-MM-dd" → ["timeactivity"] cho từng ngày
    var fundBalance: Int
    var totalSpent: Int
    var hasFund: Bool
    var backgroundImageUrl: String?

    // Custom decoder so old data (missing new fields) still decodes instead of returning nil
    init(tripId: String, tripName: String, tripEmoji: String, startDate: String?,
         endDate: String?, daysLeft: Int, status: String, todayActivities: [String],
         fundBalance: Int, totalSpent: Int, hasFund: Bool, backgroundImageUrl: String? = nil,
         schedule: [String: [String]] = [:]) {
        self.tripId = tripId; self.tripName = tripName; self.tripEmoji = tripEmoji
        self.startDate = startDate; self.endDate = endDate; self.daysLeft = daysLeft
        self.status = status; self.todayActivities = todayActivities
        self.fundBalance = fundBalance; self.totalSpent = totalSpent; self.hasFund = hasFund
        self.backgroundImageUrl = backgroundImageUrl
        self.schedule = schedule
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tripId          = (try? c.decode(String.self,   forKey: .tripId))          ?? ""
        tripName        = (try? c.decode(String.self,   forKey: .tripName))        ?? ""
        tripEmoji       = (try? c.decode(String.self,   forKey: .tripEmoji))       ?? ""
        startDate       = try? c.decode(String.self,    forKey: .startDate)
        endDate         = try? c.decode(String.self,    forKey: .endDate)
        daysLeft        = (try? c.decode(Int.self,      forKey: .daysLeft))        ?? 0
        status          = (try? c.decode(String.self,   forKey: .status))          ?? "upcoming"
        todayActivities = (try? c.decode([String].self, forKey: .todayActivities)) ?? []
        schedule        = (try? c.decode([String: [String]].self, forKey: .schedule)) ?? [:]
        fundBalance     = (try? c.decode(Int.self,      forKey: .fundBalance))     ?? 0
        totalSpent      = (try? c.decode(Int.self,      forKey: .totalSpent))      ?? 0
        hasFund         = (try? c.decode(Bool.self,     forKey: .hasFund))         ?? false
        backgroundImageUrl = try? c.decode(String.self, forKey: .backgroundImageUrl)
    }
}

// MARK: - Timeline entry

struct TripWidgetEntry: TimelineEntry {
    let date: Date
    let data: WidgetTripData?   // nil = chưa chọn trip / trip đã xoá
    let isLoggedIn: Bool
    let tripId: String?         // id trip đang cấu hình (để nạp ảnh nền theo trip)
}

struct WidgetPayloadFile: Codable, Sendable {
    var isLoggedIn: Bool
    var trip: WidgetTripData?
}

// Gộp các lần fetch ĐỒNG THỜI cho CÙNG một trip (small + medium reload cùng lúc) để
// không double token-refresh. Khác trip thì fetch riêng (key theo tripId).
actor WidgetDataLoader {
    static let shared = WidgetDataLoader()
    private var inFlight: [String: Task<WidgetPayloadFile?, Never>] = [:]

    func load(key: String, _ fetch: @Sendable @escaping () async -> WidgetPayloadFile?) async -> WidgetPayloadFile? {
        if let t = inFlight[key] { return await t.value }
        let task = Task { await fetch() }
        inFlight[key] = task
        let result = await task.value
        inFlight[key] = nil
        return result
    }
}

// Shared session store written by the main app (see WidgetBridgePlugin.swift).
struct WidgetConfigFile: Codable {
    var supabaseUrl: String
    var anonKey: String
    var accessToken: String
    var refreshToken: String
}

// MARK: - Provider (App Intent — widget cấu hình chọn trip)

struct TripWidgetProvider: AppIntentTimelineProvider {
    typealias Entry = TripWidgetEntry
    typealias Intent = SelectTripIntent

    static let appGroupID = "group.com.webcashglobal.tripmemo"
    static let configFileName = "widget_config.json"
    static let refreshInterval: TimeInterval = 45 * 60

    private static func containerURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)
    }

    // ── Local cache theo TỪNG trip ───────────────────────────────────────────
    private static func loadPayload(_ tripId: String) -> WidgetPayloadFile? {
        guard let url = containerURL()?.appendingPathComponent("widget_data_\(tripId).json"),
              let raw = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetPayloadFile.self, from: raw)
    }

    private static func savePayload(_ payload: WidgetPayloadFile, tripId: String) {
        guard let url = containerURL()?.appendingPathComponent("widget_data_\(tripId).json"),
              let encoded = try? JSONEncoder().encode(payload) else { return }
        try? encoded.write(to: url, options: .atomic)
    }

    private static func writeEcho(_ text: String) {
        guard let url = containerURL()?.appendingPathComponent("widget_echo.txt") else { return }
        try? text.write(to: url, atomically: true, encoding: .utf8)
    }

    // ── Shared session config ────────────────────────────────────────────────
    private static func loadConfig() -> WidgetConfigFile? {
        guard let url = containerURL()?.appendingPathComponent(configFileName),
              let raw = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetConfigFile.self, from: raw)
    }

    private static func saveConfig(_ cfg: WidgetConfigFile) {
        guard let url = containerURL()?.appendingPathComponent(configFileName),
              let encoded = try? JSONEncoder().encode(cfg) else { return }
        try? encoded.write(to: url, options: .atomic)
    }

    private static func hasAuthConfig() -> Bool { loadConfig() != nil }

    // ── Remote fetch theo tripId ─────────────────────────────────────────────
    private enum FetchResult {
        case success(WidgetPayloadFile)
        case unauthorized
        case failure
    }

    private static func fetchRemotePayload(tripId: String) async -> WidgetPayloadFile? {
        guard let cfg = loadConfig() else {
            writeEcho("no_config")
            return nil
        }
        switch await requestWidgetData(cfg, tripId: tripId) {
        case .success(let payload):
            await finalize(payload, tripId: tripId)
            return payload
        case .failure:
            writeEcho("network_error")
            return nil
        case .unauthorized:
            if let diskCfg = loadConfig(), diskCfg.accessToken != cfg.accessToken,
               case .success(let payload) = await requestWidgetData(diskCfg, tripId: tripId) {
                await finalize(payload, tripId: tripId)
                return payload
            }
            guard let newCfg = await refreshSession(cfg) else {
                if let diskCfg = loadConfig(), diskCfg.accessToken != cfg.accessToken,
                   case .success(let payload) = await requestWidgetData(diskCfg, tripId: tripId) {
                    await finalize(payload, tripId: tripId)
                    return payload
                }
                writeEcho("refresh_failed")
                return nil
            }
            saveConfig(newCfg)
            if case .success(let payload) = await requestWidgetData(newCfg, tripId: tripId) {
                await finalize(payload, tripId: tripId)
                return payload
            }
            writeEcho("retry_failed")
            return nil
        }
    }

    private static func finalize(_ payload: WidgetPayloadFile, tripId: String) async {
        savePayload(payload, tripId: tripId)
        writeEcho("ok:trip=\(payload.trip?.tripId ?? "nil"):days=\(payload.trip?.daysLeft ?? -1)")
        await syncBackgroundImage(payload.trip?.backgroundImageUrl, tripId: tripId)
    }

    private static func requestWidgetData(_ cfg: WidgetConfigFile, tripId: String) async -> FetchResult {
        guard var comps = URLComponents(string: cfg.supabaseUrl + "/functions/v1/widget-data") else { return .failure }
        comps.queryItems = [URLQueryItem(name: "tripId", value: tripId)]
        guard let url = comps.url else { return .failure }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.timeoutInterval = 12
        req.setValue("Bearer \(cfg.accessToken)", forHTTPHeaderField: "Authorization")
        req.setValue(cfg.anonKey, forHTTPHeaderField: "apikey")
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code == 401 || code == 403 { return .unauthorized }
            guard code == 200 else {
                log.error("widget-data HTTP \(code)")
                return .failure
            }
            let payload = try JSONDecoder().decode(WidgetPayloadFile.self, from: data)
            return .success(payload)
        } catch {
            log.error("widget-data request error: \(error.localizedDescription)")
            return .failure
        }
    }

    private static func refreshSession(_ cfg: WidgetConfigFile) async -> WidgetConfigFile? {
        guard let url = URL(string: cfg.supabaseUrl + "/auth/v1/token?grant_type=refresh_token") else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 12
        req.setValue(cfg.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": cfg.refreshToken])
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200,
                  let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let access = obj["access_token"] as? String,
                  let refresh = obj["refresh_token"] as? String else { return nil }
            return WidgetConfigFile(supabaseUrl: cfg.supabaseUrl, anonKey: cfg.anonKey,
                                    accessToken: access, refreshToken: refresh)
        } catch {
            return nil
        }
    }

    // Ảnh nền theo TỪNG trip (widget_bg_<tripId>.jpg). Dedup theo path (bỏ query token).
    @discardableResult
    private static func syncBackgroundImage(_ urlStr: String?, tripId: String) async -> Bool {
        guard let container = containerURL() else { return false }
        let fileURL = container.appendingPathComponent("widget_bg_\(tripId).jpg")
        let markerURL = container.appendingPathComponent("widget_bg_path_\(tripId).txt")
        let currentPath = try? String(contentsOf: markerURL, encoding: .utf8)

        guard let urlStr, let url = URL(string: urlStr) else {
            if FileManager.default.fileExists(atPath: fileURL.path) {
                try? FileManager.default.removeItem(at: fileURL)
                try? FileManager.default.removeItem(at: markerURL)
                return true
            }
            return false
        }
        if currentPath == url.path, FileManager.default.fileExists(atPath: fileURL.path) {
            return false
        }
        if let (data, resp) = try? await URLSession.shared.data(from: url),
           (resp as? HTTPURLResponse)?.statusCode == 200, !data.isEmpty {
            try? data.write(to: fileURL, options: .atomic)
            try? url.path.write(to: markerURL, atomically: true, encoding: .utf8)
            return true
        }
        return false
    }

    // ── Provider protocol ─────────────────────────────────────────────────────

    private var placeholderData: WidgetTripData {
        WidgetTripData(tripId: "", tripName: "Đà Lạt", tripEmoji: "🌸",
                       startDate: nil, endDate: nil,
                       daysLeft: 22, status: "upcoming",
                       todayActivities: ["Thác Datanla", "Cà phê Mê Linh"],
                       fundBalance: 1_500_000, totalSpent: 800_000, hasFund: true)
    }

    func placeholder(in context: Context) -> TripWidgetEntry {
        TripWidgetEntry(date: Date(), data: placeholderData, isLoggedIn: true, tripId: nil)
    }

    func snapshot(for configuration: SelectTripIntent, in context: Context) async -> TripWidgetEntry {
        let loggedIn = Self.hasAuthConfig()
        guard loggedIn, let tripId = configuration.trip?.id else {
            return TripWidgetEntry(date: Date(),
                                   data: loggedIn ? nil : placeholderData,
                                   isLoggedIn: loggedIn,
                                   tripId: configuration.trip?.id)
        }
        let cached = Self.loadPayload(tripId)?.trip
        return TripWidgetEntry(date: Date(), data: cached ?? placeholderData, isLoggedIn: true, tripId: tripId)
    }

    func timeline(for configuration: SelectTripIntent, in context: Context) async -> Timeline<TripWidgetEntry> {
        let loggedIn = Self.hasAuthConfig()
        let next = Date().addingTimeInterval(Self.refreshInterval)

        // Chưa đăng nhập
        if !loggedIn {
            let e = TripWidgetEntry(date: Date(), data: nil, isLoggedIn: false, tripId: nil)
            return Timeline(entries: [e], policy: .after(next))
        }
        // Chưa chọn trip
        guard let tripId = configuration.trip?.id else {
            let e = TripWidgetEntry(date: Date(), data: nil, isLoggedIn: true, tripId: nil)
            return Timeline(entries: [e], policy: .after(next))
        }

        // Fetch dữ liệu trip đã chọn (fresh); lỗi mạng thì dùng cache.
        let fresh = await WidgetDataLoader.shared.load(key: tripId) {
            await Self.fetchRemotePayload(tripId: tripId)
        }
        let payload = fresh ?? Self.loadPayload(tripId)

        // trip:null (đã xoá / mất quyền) hoặc chưa có cache → "Chưa chọn chuyến đi".
        guard let base = payload?.trip else {
            let e = TripWidgetEntry(date: Date(), data: nil, isLoggedIn: true, tripId: tripId)
            return Timeline(entries: [e], policy: .after(next))
        }

        // Entries theo ngày → đếm ngược vẫn chạy dù iOS bỏ vài lần refresh.
        let calendar = Calendar.current
        let todayStart = calendar.startOfDay(for: Date())
        let entries: [TripWidgetEntry] = (0..<30).compactMap { offset in
            guard let day = calendar.date(byAdding: .day, value: offset, to: todayStart) else { return nil }
            return TripWidgetEntry(date: day,
                                   data: Self.refreshed(base, at: day, dayOffset: offset),
                                   isLoggedIn: true,
                                   tripId: tripId)
        }
        return Timeline(entries: entries, policy: .after(next))
    }

    // Recompute daysLeft/status/todayActivities cho ngày tham chiếu.
    private static func refreshed(_ data: WidgetTripData, at refDate: Date, dayOffset: Int = 0) -> WidgetTripData {
        let calendar = Calendar.current
        var out = data

        if !data.schedule.isEmpty {
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd"
            f.locale = Locale(identifier: "en_US_POSIX")
            out.todayActivities = data.schedule[f.string(from: refDate)] ?? []
        }

        if let startStr = data.startDate, let endStr = data.endDate,
           let start = localDate(from: startStr) {
            let today = calendar.startOfDay(for: refDate)
            let diff = calendar.dateComponents([.day], from: today, to: start).day ?? 0
            out.daysLeft = max(0, diff)

            let fmt = DateFormatter()
            fmt.dateFormat = "yyyy-MM-dd"
            fmt.locale = Locale(identifier: "en_US_POSIX")
            let refStr = fmt.string(from: refDate)
            if refStr >= startStr && refStr <= endStr { out.status = "ongoing" }
            else if refStr < startStr { out.status = "upcoming" }
            else { out.status = "past" }
        } else {
            out.daysLeft = max(0, data.daysLeft - dayOffset)
            if out.daysLeft == 0 && out.status == "upcoming" { out.status = "ongoing" }
        }
        return out
    }

    private static func localDate(from str: String) -> Date? {
        let parts = str.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var comps = DateComponents()
        comps.year = parts[0]; comps.month = parts[1]; comps.day = parts[2]
        return Calendar.current.date(from: comps)
    }
}

// MARK: - Theme

extension WidgetTripData {
    var meshColors: [Color] {
        switch status {
        case "ongoing":
            return [
                Color(red: 0.06, green: 0.78, blue: 0.58), Color(red: 0.08, green: 0.65, blue: 0.72), Color(red: 0.04, green: 0.52, blue: 0.82),
                Color(red: 0.18, green: 0.82, blue: 0.52), Color(red: 0.10, green: 0.68, blue: 0.68), Color(red: 0.03, green: 0.48, blue: 0.85),
                Color(red: 0.22, green: 0.85, blue: 0.55), Color(red: 0.12, green: 0.72, blue: 0.64), Color(red: 0.05, green: 0.56, blue: 0.78),
            ]
        case "upcoming" where daysLeft <= 3:
            return [
                Color(red: 0.95, green: 0.28, blue: 0.32), Color(red: 0.90, green: 0.18, blue: 0.52), Color(red: 0.75, green: 0.10, blue: 0.58),
                Color(red: 0.98, green: 0.42, blue: 0.22), Color(red: 0.92, green: 0.24, blue: 0.45), Color(red: 0.80, green: 0.14, blue: 0.52),
                Color(red: 0.98, green: 0.52, blue: 0.28), Color(red: 0.95, green: 0.32, blue: 0.38), Color(red: 0.85, green: 0.18, blue: 0.48),
            ]
        case "upcoming" where daysLeft <= 7:
            return [
                Color(red: 0.98, green: 0.68, blue: 0.08), Color(red: 0.96, green: 0.50, blue: 0.18), Color(red: 0.90, green: 0.32, blue: 0.22),
                Color(red: 0.99, green: 0.74, blue: 0.04), Color(red: 0.96, green: 0.56, blue: 0.12), Color(red: 0.91, green: 0.38, blue: 0.16),
                Color(red: 0.96, green: 0.78, blue: 0.12), Color(red: 0.94, green: 0.62, blue: 0.06), Color(red: 0.89, green: 0.44, blue: 0.10),
            ]
        case "upcoming":
            return [
                Color(red: 0.32, green: 0.36, blue: 0.94), Color(red: 0.50, green: 0.24, blue: 0.92), Color(red: 0.66, green: 0.18, blue: 0.86),
                Color(red: 0.26, green: 0.42, blue: 0.96), Color(red: 0.42, green: 0.30, blue: 0.93), Color(red: 0.58, green: 0.20, blue: 0.89),
                Color(red: 0.20, green: 0.48, blue: 0.96), Color(red: 0.36, green: 0.35, blue: 0.92), Color(red: 0.52, green: 0.24, blue: 0.86),
            ]
        default:
            return [
                Color(red: 0.40, green: 0.46, blue: 0.58), Color(red: 0.36, green: 0.42, blue: 0.56), Color(red: 0.32, green: 0.38, blue: 0.52),
                Color(red: 0.44, green: 0.50, blue: 0.62), Color(red: 0.38, green: 0.44, blue: 0.56), Color(red: 0.34, green: 0.39, blue: 0.50),
                Color(red: 0.36, green: 0.42, blue: 0.58), Color(red: 0.30, green: 0.36, blue: 0.50), Color(red: 0.26, green: 0.32, blue: 0.44),
            ]
        }
    }

    var fallbackGradient: [Color] {
        switch status {
        case "ongoing": return [Color(red: 0.07, green: 0.76, blue: 0.55), Color(red: 0.02, green: 0.52, blue: 0.78)]
        case "upcoming" where daysLeft <= 3: return [Color(red: 0.95, green: 0.28, blue: 0.30), Color(red: 0.80, green: 0.12, blue: 0.50)]
        case "upcoming" where daysLeft <= 7: return [Color(red: 0.98, green: 0.65, blue: 0.10), Color(red: 0.90, green: 0.32, blue: 0.12)]
        case "upcoming": return [Color(red: 0.32, green: 0.38, blue: 0.95), Color(red: 0.58, green: 0.20, blue: 0.88)]
        default: return [Color(red: 0.42, green: 0.48, blue: 0.58), Color(red: 0.28, green: 0.32, blue: 0.42)]
        }
    }

    var countdownText: String { status == "upcoming" && daysLeft > 1 ? "\(daysLeft)" : "" }

    var countdownLabel: String {
        switch status {
        case "ongoing": return "ĐANG ĐI"
        case "upcoming" where daysLeft == 0: return "HÔM NAY! 🎉"
        case "upcoming" where daysLeft == 1: return "NGÀY MAI 🔥"
        case "upcoming": return "NGÀY NỮA"
        default: return "ĐÃ KẾT THÚC"
        }
    }

    var centerEmoji: String {
        switch status {
        case "ongoing": return "✈️"
        case "upcoming" where daysLeft <= 1: return "🎊"
        default: return ""
        }
    }

    var pillLabel: String {
        switch status {
        case "ongoing": return "LIVE"
        case "upcoming" where daysLeft <= 3: return "HOT"
        case "upcoming": return "SOON"
        default: return "DONE"
        }
    }
}

// MARK: - Gradient background

struct WidgetGradient: View {
    let data: WidgetTripData
    var body: some View {
        if #available(iOS 18.0, *) {
            MeshGradient(
                width: 3, height: 3,
                points: [
                    [0.0, 0.0], [0.5, 0.0], [1.0, 0.0],
                    [0.0, 0.5], [0.4, 0.4], [1.0, 0.5],
                    [0.0, 1.0], [0.6, 1.0], [1.0, 1.0],
                ],
                colors: data.meshColors
            )
        } else {
            LinearGradient(colors: data.fallbackGradient, startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }
}

struct WidgetBackground: View {
    let data: WidgetTripData
    let tripId: String
    var body: some View {
        if let photo = loadBackgroundImage(tripId: tripId) {
            ZStack {
                photo
                    .resizable()
                    .scaledToFill()
                Color.black.opacity(0.42)
            }
        } else {
            WidgetGradient(data: data)
        }
    }
}

// MARK: - Fund badge

struct FundBadge: View {
    let balance: Int
    let compact: Bool
    var body: some View {
        HStack(spacing: compact ? 3 : 4) {
            Image(systemName: "banknote.fill")
                .font(.system(size: compact ? 10 : 12, weight: .semibold))
                .foregroundColor(.white.opacity(0.85))
            VStack(alignment: .leading, spacing: 0) {
                if !compact {
                    Text("Quỹ còn lại")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(.white.opacity(0.65))
                        .kerning(0.3)
                }
                Text("\(formatMoney(balance))đ")
                    .font(.system(size: compact ? 14 : 20, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, compact ? 8 : 10)
        .padding(.vertical, compact ? 5 : 6)
        .background(.white.opacity(0.18))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

// MARK: - Small widget

struct TripWidgetSmallView: View {
    let data: WidgetTripData
    var body: some View {
        ZStack {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 5) {
                    Text(data.tripName)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Spacer(minLength: 0)
                    Text(data.pillLabel)
                        .font(.system(size: 7, weight: .black))
                        .foregroundColor(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2.5)
                        .background(.white.opacity(0.25))
                        .clipShape(Capsule())
                }

                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 0) {
                    if !data.countdownText.isEmpty {
                        Text(data.countdownText)
                            .font(.system(size: 50, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                            .minimumScaleFactor(0.4)
                            .lineLimit(1)
                            .shadow(color: .black.opacity(0.15), radius: 6, y: 3)
                    } else {
                        Text(data.centerEmoji)
                            .font(.system(size: 40))
                    }
                    Text(data.countdownLabel)
                        .font(.system(size: 9, weight: .black))
                        .foregroundColor(.white.opacity(0.80))
                        .kerning(2.0)
                        .padding(.top, 2)

                    if data.hasFund {
                        FundBadge(balance: data.fundBalance, compact: true)
                            .padding(.top, 6)
                    } else if data.totalSpent > 0 {
                        HStack(spacing: 3) {
                            Image(systemName: "cart.fill")
                                .font(.system(size: 9))
                                .foregroundColor(.white.opacity(0.55))
                            Text("Đã chi: \(formatMoney(data.totalSpent))đ")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundColor(.white.opacity(0.60))
                        }
                        .padding(.top, 5)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
    }
}

// MARK: - Medium widget

struct TripWidgetMediumView: View {
    let data: WidgetTripData
    var body: some View {
        ZStack {
            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 5) {
                        Text(data.tripName)
                            .font(.system(size: 13, weight: .bold, design: .rounded))
                            .foregroundColor(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Text(data.pillLabel)
                            .font(.system(size: 7, weight: .black))
                            .foregroundColor(.white)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2.5)
                            .background(.white.opacity(0.25))
                            .clipShape(Capsule())
                    }

                    Spacer(minLength: 0)

                    VStack(alignment: .leading, spacing: 0) {
                        if !data.countdownText.isEmpty {
                            Text(data.countdownText)
                                .font(.system(size: 50, weight: .black, design: .rounded))
                                .foregroundColor(.white)
                                .minimumScaleFactor(0.4)
                                .lineLimit(1)
                                .shadow(color: .black.opacity(0.15), radius: 6, y: 3)
                        } else {
                            Text(data.centerEmoji)
                                .font(.system(size: 44))
                        }
                        Text(data.countdownLabel)
                            .font(.system(size: 9, weight: .black))
                            .foregroundColor(.white.opacity(0.80))
                            .kerning(2.0)
                            .padding(.top, 2)

                        if data.hasFund {
                            FundBadge(balance: data.fundBalance, compact: true)
                                .padding(.top, 8)
                        } else if data.totalSpent > 0 {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Tổng chi tiêu")
                                    .font(.system(size: 8, weight: .semibold))
                                    .foregroundColor(.white.opacity(0.60))
                                Text("\(formatMoney(data.totalSpent))đ")
                                    .font(.system(size: 18, weight: .black, design: .rounded))
                                    .foregroundColor(.white)
                            }
                            .padding(.top, 6)
                        }
                    }
                }
                .frame(maxHeight: .infinity, alignment: .leading)
                .frame(width: 148)

                Rectangle()
                    .fill(.white.opacity(0.20))
                    .frame(width: 1)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 10)

                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 5) {
                        Image(systemName: "calendar")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundColor(.white.opacity(0.65))
                        Text("Hôm nay")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.white.opacity(0.75))
                    }
                    .padding(.bottom, 8)

                    if data.todayActivities.isEmpty {
                        Spacer()
                        Text("Không có\nlịch trình")
                            .font(.system(size: 11))
                            .foregroundColor(.white.opacity(0.50))
                            .italic()
                        Spacer()
                    } else {
                        ForEach(Array(data.todayActivities.prefix(3).enumerated()), id: \.offset) { idx, act in
                            let parts = act.components(separatedBy: "\u{1}")
                            let time = parts.count > 1 ? parts[0] : ""
                            let name = parts.count > 1 ? parts[1] : parts[0]
                            HStack(alignment: .center, spacing: 6) {
                                Text(time.isEmpty ? "\(idx + 1)" : time)
                                    .font(.system(size: 9, weight: .black, design: .rounded))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, time.isEmpty ? 0 : 5)
                                    .frame(minWidth: 16, minHeight: 16)
                                    .background(.white.opacity(0.22))
                                    .clipShape(Capsule())
                                Text(name)
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundColor(.white)
                                    .lineLimit(1)
                            }
                            .padding(.bottom, 5)
                        }
                        Spacer()
                    }

                    if data.hasFund && data.totalSpent > 0 {
                        HStack(spacing: 4) {
                            Image(systemName: "creditcard.fill")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(.white)
                            Text("Đã chi \(formatMoney(data.totalSpent))đ")
                                .font(.system(size: 12, weight: .black, design: .rounded))
                                .foregroundColor(.white)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                        }
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(
                            LinearGradient(
                                colors: [Color(red: 0.98, green: 0.42, blue: 0.22),
                                         Color(red: 0.95, green: 0.24, blue: 0.42)],
                                startPoint: .leading, endPoint: .trailing
                            )
                        )
                        .clipShape(Capsule())
                        .shadow(color: .black.opacity(0.28), radius: 4, y: 2)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
    }
}

// MARK: - Login prompt

struct LoginGradient: View {
    var body: some View {
        LinearGradient(
            colors: [
                Color(red: 0.32, green: 0.36, blue: 0.94),
                Color(red: 0.58, green: 0.20, blue: 0.88),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

struct LoginPromptView: View {
    var body: some View {
        VStack(spacing: 6) {
            Text("✈️").font(.system(size: 34))
            Text("TripMemo")
                .font(.system(size: 14, weight: .black, design: .rounded))
                .foregroundColor(.white)
            Text("Đăng nhập để\nxem chuyến đi")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white.opacity(0.75))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Empty state (chưa chọn chuyến đi)

struct EmptyStateGradient: View {
    var body: some View {
        LinearGradient(
            colors: [Color(red: 0.40, green: 0.46, blue: 0.58), Color(red: 0.26, green: 0.30, blue: 0.40)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
    }
}

struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 6) {
            Text("🧳").font(.system(size: 32))
            Text("Chưa chọn chuyến đi")
                .font(.system(size: 13, weight: .black, design: .rounded))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
            Text("Nhấn giữ widget → Chỉnh sửa\nđể chọn chuyến đi")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.white.opacity(0.75))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(12)
    }
}

// MARK: - Entry view + Widget

struct TripWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: TripWidgetEntry

    @ViewBuilder var content: some View {
        if !entry.isLoggedIn {
            LoginPromptView()
        } else if let data = entry.data {
            switch family {
            case .systemMedium: TripWidgetMediumView(data: data)
            default:            TripWidgetSmallView(data: data)
            }
        } else {
            EmptyStateView()
        }
    }

    var body: some View {
        content
            .containerBackground(for: .widget) {
                if !entry.isLoggedIn {
                    LoginGradient()
                } else if let data = entry.data, let tripId = entry.tripId {
                    WidgetBackground(data: data, tripId: tripId)
                } else {
                    EmptyStateGradient()
                }
            }
    }
}

struct TripWidget: Widget {
    let kind: String = "TripWidget"
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: SelectTripIntent.self, provider: TripWidgetProvider()) { entry in
            TripWidgetView(entry: entry)
                .widgetURL(widgetURL(for: entry))
        }
        .configurationDisplayName("TripMemo")
        .description("Chọn chuyến đi để hiển thị đếm ngược.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }

    private func widgetURL(for entry: TripWidgetEntry) -> URL? {
        if !entry.isLoggedIn { return URL(string: "tripmemo://login") }
        if let id = entry.data?.tripId, !id.isEmpty { return URL(string: "tripmemo://trip/\(id)") }
        return URL(string: "tripmemo://")
    }
}

// MARK: - Helpers

private func formatMoney(_ value: Int) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.groupingSeparator = "."
    formatter.groupingSize = 3
    formatter.maximumFractionDigits = 0
    return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
}

private func loadBackgroundImage(tripId: String) -> Image? {
    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: TripWidgetProvider.appGroupID
    ) else { return nil }
    let fileURL = containerURL.appendingPathComponent("widget_bg_\(tripId).jpg")
    guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }

    // Downsample để không vượt ngân sách bộ nhớ ~30MB của widget extension.
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceShouldCacheImmediately: true,
        kCGImageSourceThumbnailMaxPixelSize: 800,
    ]
    guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, nil),
          let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    else { return nil }
    return Image(uiImage: UIImage(cgImage: cgImage))
}

// MARK: - Preview

#Preview(as: .systemSmall) {
    TripWidget()
} timeline: {
    TripWidgetEntry(date: Date(), data: WidgetTripData(tripId: "preview_1", tripName: "Đà Lạt", tripEmoji: "🌸",
        startDate: nil, endDate: nil, daysLeft: 22, status: "upcoming",
        todayActivities: ["Thác Datanla"], fundBalance: 1_500_000, totalSpent: 800_000, hasFund: true),
        isLoggedIn: true, tripId: "preview_1")
    TripWidgetEntry(date: Date(), data: nil, isLoggedIn: true, tripId: nil)
}
