import Capacitor
import WidgetKit

@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "updateWidgetData",   returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWidgetLoggedIn",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWidgetLoggedOut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readWidgetEcho",     returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWidgetAuth",      returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWidgetAuth",      returnType: CAPPluginReturnPromise),
    ]

    private static let appGroup = "group.com.webcashglobal.tripmemo"
    private static let dataFileName = "widget_data.json"
    private static let configFileName = "widget_config.json"

    // Debounced widget reload. At login the app writes auth + trip + image in quick
    // succession; calling reloadAllTimelines() each time makes WidgetKit throttle the
    // burst and can leave one widget family stuck on a stale (pre-login) timeline.
    // Coalescing into a single reload shortly after the LAST write avoids that, while
    // a short delay keeps edits feeling responsive on the widget.
    private static var reloadWorkItem: DispatchWorkItem?
    private static func scheduleReload() {
        guard #available(iOS 14.0, *) else { return }
        DispatchQueue.main.async {
            reloadWorkItem?.cancel()
            let item = DispatchWorkItem { WidgetCenter.shared.reloadAllTimelines() }
            reloadWorkItem = item
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: item)
        }
    }

    // App Group UserDefaults is unreliable across the app/extension boundary
    // ("Using kCFPreferencesAnyUser with a container ... detaching from cfprefsd").
    // The shared container FILE works reliably (same path the image uses), so we
    // persist the widget payload as a JSON file there instead.
    private static func dataFileURL() -> URL? {
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
            print("[WidgetBridge] ❌ App Group container = nil — App Group not provisioned in portal?")
            return nil
        }
        print("[WidgetBridge] ✅ App Group container: \(container.path)")
        return container.appendingPathComponent(dataFileName)
    }

    private static func loadPayload() -> WidgetPayloadFile? {
        guard let url = dataFileURL(),
              let data = try? Data(contentsOf: url),
              let payload = try? JSONDecoder().decode(WidgetPayloadFile.self, from: data)
        else { return nil }
        return payload
    }

    private static func savePayload(_ payload: WidgetPayloadFile) {
        guard let url = dataFileURL(),
              let encoded = try? JSONEncoder().encode(payload) else {
            print("[WidgetBridge] ❌ savePayload: URL or encode failed")
            return
        }
        do {
            try encoded.write(to: url, options: .atomic)
            print("[WidgetBridge] ✅ File written: \(url.path) (\(encoded.count) bytes)")
        } catch {
            print("[WidgetBridge] ❌ File write error: \(error)")
        }
    }

    @objc func updateWidgetData(_ call: CAPPluginCall) {
        guard
            let tripName = call.getString("tripName"),
            let tripEmoji = call.getString("tripEmoji"),
            let status = call.getString("status")
        else {
            call.reject("Missing required fields")
            return
        }

        var data = WidgetTripData(
            tripId:          call.getString("tripId") ?? "",
            tripName:        tripName,
            tripEmoji:       tripEmoji,
            startDate:       call.getString("startDate"),
            endDate:         call.getString("endDate"),
            daysLeft:        call.getInt("daysLeft") ?? 0,
            status:          status,
            todayActivities: call.getArray("todayActivities") as? [String] ?? [],
            fundBalance:     call.getInt("fundBalance") ?? 0,
            totalSpent:      call.getInt("totalSpent") ?? 0,
            hasFund:         call.getBool("hasFund") ?? false
        )

        // Keep existing fund data if new payload has no fund (e.g. app-launch basic update)
        if !data.hasFund,
           let prev = Self.loadPayload()?.trip, prev.tripId == data.tripId, prev.hasFund {
            data.hasFund = prev.hasFund
            data.fundBalance = prev.fundBalance
            data.totalSpent = prev.totalSpent
        }

        Self.savePayload(WidgetPayloadFile(isLoggedIn: true, trip: data))

        // Coalesced reload — fires once after auth/trip/image writes settle.
        Self.scheduleReload()

        let bgUrlStr = call.getString("backgroundImageUrl")
        print("[Widget] daysLeft: \(data.daysLeft) | fundBalance: \(data.fundBalance) | hasFund: \(data.hasFund) | bgUrl: \(bgUrlStr ?? "(none)")")

        // Đồng bộ ảnh nền theo ĐÚNG trip hiện tại.
        if let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup) {
            let fileURL = containerURL.appendingPathComponent("widget_bg.jpg")
            let markerURL = containerURL.appendingPathComponent("widget_bg_path.txt")
            if let urlStr = bgUrlStr, let url = URL(string: urlStr) {
                URLSession.shared.dataTask(with: url) { imageData, response, _ in
                    if let imageData, !imageData.isEmpty,
                       (response as? HTTPURLResponse)?.statusCode == 200 {
                        try? imageData.write(to: fileURL, options: .atomic)
                        try? url.path.write(to: markerURL, atomically: true, encoding: .utf8)
                        print("[Widget] ✅ Image saved: \(imageData.count) bytes")
                    } else {
                        print("[Widget] ❌ No image data — HTTP: \((response as? HTTPURLResponse)?.statusCode ?? -1)")
                    }
                    Self.scheduleReload()
                }.resume()
            } else {
                // Trip mới KHÔNG có ảnh → xoá ảnh cũ để không hiện nhầm ảnh trip trước
                try? FileManager.default.removeItem(at: fileURL)
                try? FileManager.default.removeItem(at: markerURL)
                print("[Widget] 🗑️ No bg for this trip — cleared old image")
                Self.scheduleReload()
            }
        }

        call.resolve()
    }

    // Mark user as logged-in immediately (before trip data is ready).
    // Prevents the widget from showing the "Đăng nhập" prompt while data loads.
    @objc func setWidgetLoggedIn(_ call: CAPPluginCall) {
        let existing = Self.loadPayload()
        // Only write if file doesn't exist or isLoggedIn is currently false.
        // Do NOT call reloadAllTimelines() here — updateWidgetData() will call it
        // immediately after with real trip data. Two rapid reloads cause iOS to
        // throttle the second one, leaving widgets stuck on the placeholder state.
        if existing == nil || existing?.isLoggedIn == false {
            Self.savePayload(WidgetPayloadFile(isLoggedIn: true, trip: existing?.trip))
        }
        call.resolve()
    }

    @objc func setWidgetLoggedOut(_ call: CAPPluginCall) {
        // Preserve any existing trip data, just flip the flag off.
        let trip = Self.loadPayload()?.trip
        Self.savePayload(WidgetPayloadFile(isLoggedIn: false, trip: trip))
        // Clear the shared session so the widget stops fetching.
        Self.saveConfig(nil)
        Self.scheduleReload()
        call.resolve()
    }

    // Read the echo file written by the widget extension after each getTimeline() call.
    // Tells us whether the extension can access the App Group and read widget_data.json.
    // Result meanings:
    //   echo="no_echo_yet"  → extension never ran, or can't write to App Group (provisioning issue)
    //   echo="file_missing" → extension has App Group but widget_data.json not found
    //   echo="ok:..."       → extension read the file correctly — rendering bug
    @objc func readWidgetEcho(_ call: CAPPluginCall) {
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup) else {
            call.resolve(["echo": "app_no_container", "appHasGroup": false])
            return
        }
        let echoURL = container.appendingPathComponent("widget_echo.txt")
        let echo = (try? String(contentsOf: echoURL, encoding: .utf8)) ?? "no_echo_yet"
        call.resolve(["echo": echo, "appHasGroup": true])
    }

    // ── Auth config (shared session for the self-fetching widget) ─────────────
    // The widget extension reads widget_config.json to call the `widget-data`
    // edge function on its own — so it stays fresh even when the app is closed.
    // This file is the single source of truth for the session: both the app and
    // the widget write the latest (possibly rotated) tokens here.

    private static func configFileURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(configFileName)
    }

    private static func loadConfig() -> WidgetConfigFile? {
        guard let url = configFileURL(),
              let data = try? Data(contentsOf: url),
              let cfg = try? JSONDecoder().decode(WidgetConfigFile.self, from: data)
        else { return nil }
        return cfg
    }

    private static func saveConfig(_ cfg: WidgetConfigFile?) {
        guard let url = configFileURL() else { return }
        guard let cfg, let encoded = try? JSONEncoder().encode(cfg) else {
            try? FileManager.default.removeItem(at: url) // clear on logout
            return
        }
        try? encoded.write(to: url, options: .atomic)
    }

    @objc func setWidgetAuth(_ call: CAPPluginCall) {
        guard
            let supabaseUrl  = call.getString("supabaseUrl"),
            let anonKey      = call.getString("anonKey"),
            let accessToken  = call.getString("accessToken"),
            let refreshToken = call.getString("refreshToken")
        else {
            call.reject("Missing auth fields")
            return
        }
        Self.saveConfig(WidgetConfigFile(
            supabaseUrl: supabaseUrl,
            anonKey: anonKey,
            accessToken: accessToken,
            refreshToken: refreshToken
        ))
        Self.scheduleReload()
        call.resolve()
    }

    // The widget may rotate the refresh token while the app is closed; the app
    // calls this on startup to adopt whatever tokens are currently in the file.
    @objc func getWidgetAuth(_ call: CAPPluginCall) {
        guard let cfg = Self.loadConfig() else {
            call.resolve(["hasAuth": false])
            return
        }
        call.resolve([
            "hasAuth": true,
            "accessToken": cfg.accessToken,
            "refreshToken": cfg.refreshToken,
        ])
    }
}

struct WidgetTripData: Codable {
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
}

struct WidgetPayloadFile: Codable {
    var isLoggedIn: Bool
    var trip: WidgetTripData?
}

// Shared session store read by the widget extension (see TripWidget.swift).
struct WidgetConfigFile: Codable {
    var supabaseUrl: String
    var anonKey: String
    var accessToken: String
    var refreshToken: String
}
