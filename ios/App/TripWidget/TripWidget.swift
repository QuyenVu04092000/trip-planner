import WidgetKit
import SwiftUI
import OSLog
import ImageIO

private let log = Logger(subsystem: "com.quyenvu.tripmemo.TripWidgetExtension", category: "Widget")

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
    var fundBalance: Int
    var totalSpent: Int
    var hasFund: Bool
    var backgroundImageUrl: String?

    // Custom decoder so old UserDefaults data (missing new fields) still decodes instead of returning nil
    init(tripId: String, tripName: String, tripEmoji: String, startDate: String?,
         endDate: String?, daysLeft: Int, status: String, todayActivities: [String],
         fundBalance: Int, totalSpent: Int, hasFund: Bool, backgroundImageUrl: String? = nil) {
        self.tripId = tripId; self.tripName = tripName; self.tripEmoji = tripEmoji
        self.startDate = startDate; self.endDate = endDate; self.daysLeft = daysLeft
        self.status = status; self.todayActivities = todayActivities
        self.fundBalance = fundBalance; self.totalSpent = totalSpent; self.hasFund = hasFund
        self.backgroundImageUrl = backgroundImageUrl
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
        fundBalance     = (try? c.decode(Int.self,      forKey: .fundBalance))     ?? 0
        totalSpent      = (try? c.decode(Int.self,      forKey: .totalSpent))      ?? 0
        hasFund         = (try? c.decode(Bool.self,     forKey: .hasFund))         ?? false
        backgroundImageUrl = try? c.decode(String.self, forKey: .backgroundImageUrl)
    }
}

// MARK: - Timeline entry & provider

struct TripWidgetEntry: TimelineEntry {
    let date: Date
    let data: WidgetTripData
    let isLoggedIn: Bool
}

struct WidgetPayloadFile: Codable, Sendable {
    var isLoggedIn: Bool
    var trip: WidgetTripData?
}

// Coalesces concurrent timeline fetches across widget families. Without this,
// the small + medium widgets reload together and BOTH try to refresh the access
// token with the same (rotating) refresh token — the second one fails and shows
// no data. Here only one network fetch + token refresh runs; both families share
// the result.
actor WidgetDataLoader {
    static let shared = WidgetDataLoader()

    private var inFlight: Task<WidgetPayloadFile?, Never>?

    func load(_ fetch: @Sendable @escaping () async -> WidgetPayloadFile?) async -> WidgetPayloadFile? {
        // Only coalesce genuinely CONCURRENT fetches: the small + medium families
        // reload within the same instant, so the second one awaits the first's
        // task instead of racing a parallel token refresh.
        //
        // We deliberately do NOT cache the result for a time window. A previous
        // 20s cache made edits feel laggy: a reload triggered right after the user
        // changed a trip returned the stale cached payload instead of re-fetching,
        // so the change only appeared up to ~20s later.
        if let inFlight {
            return await inFlight.value
        }
        let task = Task { await fetch() }
        inFlight = task
        let result = await task.value
        inFlight = nil
        return result
    }
}

// Shared session store written by the main app (see WidgetBridgePlugin.swift).
// The widget reads it to call the `widget-data` edge function on its own.
struct WidgetConfigFile: Codable {
    var supabaseUrl: String
    var anonKey: String
    var accessToken: String
    var refreshToken: String
}

struct TripWidgetProvider: TimelineProvider {
    static let appGroupID  = "group.com.quyenvu04092000.tripmemo"
    static let dataFileName = "widget_data.json"
    static let configFileName = "widget_config.json"

    // How often the widget tries to pull fresh data from Supabase. iOS ultimately
    // controls the budget, but this is the requested cadence.
    static let refreshInterval: TimeInterval = 45 * 60

    private static func containerURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)
    }

    // ── Local cache (last known good payload) ────────────────────────────────

    private static func loadPayload() -> WidgetPayloadFile? {
        guard let container = containerURL() else {
            log.error("❌ App Group container nil — entitlement chưa được cấp cho extension")
            return nil
        }
        let url = container.appendingPathComponent(dataFileName)
        guard let raw = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetPayloadFile.self, from: raw)
    }

    private static func savePayload(_ payload: WidgetPayloadFile) {
        guard let url = containerURL()?.appendingPathComponent(dataFileName),
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

    // ── Remote fetch (self-updating, no app launch needed) ───────────────────

    private enum FetchResult {
        case success(WidgetPayloadFile)
        case unauthorized
        case failure
    }

    // Calls the edge function; refreshes the access token once on 401 and retries.
    private static func fetchRemotePayload() async -> WidgetPayloadFile? {
        guard let cfg = loadConfig() else {
            writeEcho("no_config")
            return nil
        }

        switch await requestWidgetData(cfg) {
        case .success(let payload):
            await finalize(payload)
            return payload
        case .failure:
            writeEcho("network_error")
            return nil
        case .unauthorized:
            // A sibling widget family may have already rotated + saved a fresh
            // token. Prefer that over rotating again (which would fail, since the
            // refresh token is single-use).
            if let diskCfg = loadConfig(), diskCfg.accessToken != cfg.accessToken,
               case .success(let payload) = await requestWidgetData(diskCfg) {
                await finalize(payload)
                return payload
            }
            guard let newCfg = await refreshSession(cfg) else {
                // Refresh failed — a sibling likely won the rotation race. Adopt
                // whatever token is on disk now and try once more.
                if let diskCfg = loadConfig(), diskCfg.accessToken != cfg.accessToken,
                   case .success(let payload) = await requestWidgetData(diskCfg) {
                    await finalize(payload)
                    return payload
                }
                writeEcho("refresh_failed")
                return nil
            }
            saveConfig(newCfg)
            if case .success(let payload) = await requestWidgetData(newCfg) {
                await finalize(payload)
                return payload
            }
            writeEcho("retry_failed")
            return nil
        }
    }

    // Cache the payload + sync the background image so the widget can render offline.
    private static func finalize(_ payload: WidgetPayloadFile) async {
        savePayload(payload)
        writeEcho("ok:loggedIn=\(payload.isLoggedIn):trip=\(payload.trip?.tripId ?? "nil"):days=\(payload.trip?.daysLeft ?? -1)")
        await syncBackgroundImage(payload.trip?.backgroundImageUrl)
    }

    private static func requestWidgetData(_ cfg: WidgetConfigFile) async -> FetchResult {
        guard let url = URL(string: cfg.supabaseUrl + "/functions/v1/widget-data") else { return .failure }
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

    // Exchanges the (rotating) refresh token for a fresh session via GoTrue.
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

    // Downloads (or clears) the rotating background photo into the App Group.
    private static func syncBackgroundImage(_ urlStr: String?) async {
        guard let fileURL = containerURL()?.appendingPathComponent("widget_bg.jpg") else { return }
        guard let urlStr, let url = URL(string: urlStr) else {
            try? FileManager.default.removeItem(at: fileURL) // no media → fall back to gradient
            return
        }
        if let (data, resp) = try? await URLSession.shared.data(from: url),
           (resp as? HTTPURLResponse)?.statusCode == 200, !data.isEmpty {
            try? data.write(to: fileURL, options: .atomic)
        }
    }

    // ── TimelineProvider ─────────────────────────────────────────────────────

    private var placeholderData: WidgetTripData {
        WidgetTripData(tripId: "", tripName: "Đà Lạt", tripEmoji: "🌸",
                       startDate: nil, endDate: nil,
                       daysLeft: 22, status: "upcoming",
                       todayActivities: ["Thác Datanla", "Cà phê Mê Linh"],
                       fundBalance: 1_500_000, totalSpent: 800_000, hasFund: true)
    }

    func placeholder(in context: Context) -> TripWidgetEntry {
        TripWidgetEntry(date: Date(), data: placeholderData, isLoggedIn: true)
    }

    // If a session config exists, the user IS logged in — even if a data fetch
    // hasn't succeeded yet. Deriving "logged in" from the payload alone made one
    // family stick on the "Đăng nhập" prompt when its first fetch failed.
    private static func hasAuthConfig() -> Bool { loadConfig() != nil }

    // The session config file is the SINGLE source of truth for "is the user
    // logged in". The fetched payload only decides whether we have trip DATA.
    // Deriving login from the config (not the payload) guarantees:
    //   • a transient fetch failure never drops the widget to LoginPrompt;
    //   • Small and Medium always agree (they read the same file);
    //   • the "trip data present but isLoggedIn=false" state is impossible.
    private static func resolveLoggedIn(_ payload: WidgetPayloadFile?) -> Bool {
        // Config present → logged in, period. Also treat a cached logged-in payload
        // as logged-in to cover the brief window before the config is written.
        hasAuthConfig() || (payload?.isLoggedIn ?? false)
    }

    // ── Live reads for the entry view ────────────────────────────────────────
    // A widget's `isLoggedIn` / data is baked into the timeline when it's created.
    // If iOS holds a stale PRE-LOGIN timeline (common on the small family due to
    // per-widget refresh budgets), the view would keep showing the login prompt /
    // placeholder forever. These let the view read the CURRENT state from the App
    // Group at render time, so a stale timeline self-heals without a reload.
    // Live login = config present OR the cached payload says logged-in. Checking
    // the cache too lets a stale pre-login timeline self-heal from widget_data.json
    // (which the app always writes with isLoggedIn=true) even before the session
    // config file exists.
    static func isLoggedInNow() -> Bool { resolveLoggedIn(loadPayload()) }
    static func liveTrip() -> WidgetTripData? {
        guard let trip = loadPayload()?.trip else { return nil }
        return refreshed(trip, at: Date())
    }

    // Snapshot must be fast (widget gallery / transitions) — use the cache only.
    func getSnapshot(in context: Context, completion: @escaping (TripWidgetEntry) -> Void) {
        let cached = Self.loadPayload()
        let loggedIn = Self.resolveLoggedIn(cached)
        let base = cached?.trip ?? placeholderData
        completion(TripWidgetEntry(date: Date(), data: Self.refreshed(base, at: Date()), isLoggedIn: loggedIn))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TripWidgetEntry>) -> Void) {
        // Build the timeline from the CACHE and return IMMEDIATELY. A widget
        // extension has a very short execution budget; blocking here on a network
        // fetch (token refresh + edge function, up to ~20s) can exceed it, so iOS
        // kills the extension before `completion` runs and the widget stays stuck
        // on the gray "loading" placeholder. That's exactly what broke the small
        // widget. The network refresh now runs in the background (see below).
        let cached = Self.loadPayload()
        let loggedIn = Self.resolveLoggedIn(cached)
        let base = cached?.trip ?? placeholderData
        let hasRealTrip = cached?.trip != nil

        // Daily entries keep the countdown ticking even if iOS skips refreshes.
        let calendar = Calendar.current
        let todayStart = calendar.startOfDay(for: Date())
        let entries: [TripWidgetEntry] = (0..<30).compactMap { offset in
            guard let day = calendar.date(byAdding: .day, value: offset, to: todayStart) else { return nil }
            return TripWidgetEntry(date: day, data: Self.refreshed(base, at: day, dayOffset: offset), isLoggedIn: loggedIn)
        }

        // If we don't have real data yet, retry on a MODERATE cadence. A tight retry
        // burns the per-widget refresh budget, after which iOS stops regenerating
        // the timeline entirely.
        let interval: TimeInterval = hasRealTrip ? Self.refreshInterval : 15 * 60
        completion(Timeline(entries: entries, policy: .after(Date().addingTimeInterval(interval))))

        // Background refresh — does NOT block the timeline above. If the freshly
        // fetched payload differs from what we just rendered, ask iOS for one reload
        // so the new data shows. The diff check prevents an infinite reload loop.
        let before = cached.flatMap { try? JSONEncoder().encode($0) }
        Task.detached {
            guard let fresh = await WidgetDataLoader.shared.load({ await Self.fetchRemotePayload() }) else { return }
            let after = try? JSONEncoder().encode(fresh)
            if before != after, #available(iOS 14.0, *) {
                WidgetCenter.shared.reloadAllTimelines()
            }
        }
    }

    // Recompute daysLeft and status from stored startDate/endDate for a given reference date.
    // Fallback when dates unavailable: decrement stored daysLeft by dayOffset so it still ticks down.
    private static func refreshed(_ data: WidgetTripData, at refDate: Date, dayOffset: Int = 0) -> WidgetTripData {
        let calendar = Calendar.current
        var out = data

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
            // No dates in UserDefaults (old cache) — decrement by day offset so countdown still ticks
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
    var body: some View {
        if let photo = loadBackgroundImage() {
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
                // Title row
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

                // Single spacer pushes countdown block down
                Spacer(minLength: 0)

                // Countdown block — always rendered as a unit so nothing gets clipped
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
                // Left: countdown
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

                    // Single spacer — lets the countdown+badge block sit at the bottom
                    Spacer(minLength: 0)

                    // Countdown + badge as one block so badge is never clipped
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

                // Right: activities
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
            Text("✈️")
                .font(.system(size: 34))
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

// MARK: - Entry view + Widget

struct TripWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: TripWidgetEntry

    // Prefer the live App-Group state over the value baked into this (possibly
    // stale) timeline, so a frozen pre-login small widget recovers on its own.
    private var isLoggedIn: Bool { entry.isLoggedIn || TripWidgetProvider.isLoggedInNow() }
    private var data: WidgetTripData {
        // Baked entry is a placeholder (empty tripId) but a real trip is cached →
        // show the live cached trip instead of the hardcoded placeholder.
        if entry.data.tripId.isEmpty, let live = TripWidgetProvider.liveTrip() { return live }
        return entry.data
    }

    @ViewBuilder var content: some View {
        if !isLoggedIn {
            LoginPromptView()
        } else {
            switch family {
            case .systemSmall:  TripWidgetSmallView(data: data)
            case .systemMedium: TripWidgetMediumView(data: data)
            default:            TripWidgetSmallView(data: data)
            }
        }
    }

    var body: some View {
        content
            // iOS 17+ uses containerBackground as THE widget background. Drawing the
            // background here (instead of inside a ZStack with a .clear container)
            // prevents the system from falling back to its gray placeholder background.
            .containerBackground(for: .widget) {
                if isLoggedIn {
                    WidgetBackground(data: data)
                } else {
                    LoginGradient()
                }
            }
    }
}

struct TripWidget: Widget {
    let kind: String = "TripWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TripWidgetProvider()) { entry in
            TripWidgetView(entry: entry)
                .widgetURL(entry.isLoggedIn ? URL(string: "tripmemo://trip/\(entry.data.tripId)") : URL(string: "tripmemo://login"))
        }
        .configurationDisplayName("TripMemo")
        .description("Xem nhanh chuyến đi của bạn.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
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

private func loadBackgroundImage() -> Image? {
    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: TripWidgetProvider.appGroupID
    ) else { return nil }
    let fileURL = containerURL.appendingPathComponent("widget_bg.jpg")
    guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }

    // Downsample instead of loading the full-resolution photo. A widget extension
    // has a very tight memory budget (~30MB); decoding a large trip photo can blow
    // past it and get the extension jetsammed — which makes iOS fall back to the
    // gray "loading" placeholder (this hit the small family hardest). Thumbnailing
    // via ImageIO never fully decodes the original, so memory stays tiny.
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
        todayActivities: ["Thác Datanla"], fundBalance: 1_500_000, totalSpent: 800_000, hasFund: true), isLoggedIn: true)
    TripWidgetEntry(date: Date(), data: WidgetTripData(tripId: "preview_2", tripName: "Phú Quốc", tripEmoji: "🏖️",
        startDate: nil, endDate: nil, daysLeft: 3, status: "upcoming",
        todayActivities: [], fundBalance: 2_200_000, totalSpent: 1_100_000, hasFund: true), isLoggedIn: true)
    TripWidgetEntry(date: Date(), data: WidgetTripData(tripId: "preview_3", tripName: "Hội An", tripEmoji: "🏮",
        startDate: nil, endDate: nil, daysLeft: 0, status: "ongoing",
        todayActivities: ["Phố cổ", "Bánh mì"], fundBalance: 800_000, totalSpent: 1_200_000, hasFund: true), isLoggedIn: true)
    TripWidgetEntry(date: Date(), data: WidgetTripData(tripId: "", tripName: "", tripEmoji: "",
        startDate: nil, endDate: nil, daysLeft: 0, status: "upcoming",
        todayActivities: [], fundBalance: 0, totalSpent: 0, hasFund: false), isLoggedIn: false)
}

#Preview(as: .systemMedium) {
    TripWidget()
} timeline: {
    TripWidgetEntry(date: Date(), data: WidgetTripData(tripId: "preview_2", tripName: "Phú Quốc", tripEmoji: "🏖️",
        startDate: nil, endDate: nil, daysLeft: 0, status: "ongoing",
        todayActivities: ["Lặn ngắm san hô", "Sunset Sanato", "Hải sản Dinh Cậu"],
        fundBalance: 2_200_000, totalSpent: 1_100_000, hasFund: true), isLoggedIn: true)
    TripWidgetEntry(date: Date(), data: WidgetTripData(tripId: "preview_4", tripName: "Hà Nội", tripEmoji: "🏛️",
        startDate: nil, endDate: nil, daysLeft: 5, status: "upcoming",
        todayActivities: [], fundBalance: 0, totalSpent: 0, hasFund: false), isLoggedIn: true)
    TripWidgetEntry(date: Date(), data: WidgetTripData(tripId: "", tripName: "", tripEmoji: "",
        startDate: nil, endDate: nil, daysLeft: 0, status: "upcoming",
        todayActivities: [], fundBalance: 0, totalSpent: 0, hasFund: false), isLoggedIn: false)
}
