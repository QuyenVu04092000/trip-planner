import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var pendingDeepLink: URL?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        if let url = pendingDeepLink {
            pendingDeepLink = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                self.navigateToTripURL(url)
            }
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        if url.scheme == "tripmemo" {
            if !navigateToTripURL(url) {
                pendingDeepLink = url
            }
        }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    @discardableResult
    private func navigateToTripURL(_ url: URL) -> Bool {
        guard url.host == "trip",
              let tripId = url.pathComponents.dropFirst().first,
              tripId.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" })
        else { return false }
        guard let vc = window?.rootViewController,
              let capVC = findBridgeVC(vc)
        else { return false }
        let hash = "#/trip/\(tripId)/plan"
        capVC.webView?.evaluateJavaScript("window.location.hash = '\(hash)'")
        return true
    }

    private func findBridgeVC(_ vc: UIViewController) -> CAPBridgeViewController? {
        if let cap = vc as? CAPBridgeViewController { return cap }
        for child in vc.children { if let found = findBridgeVC(child) { return found } }
        if let presented = vc.presentedViewController { return findBridgeVC(presented) }
        return nil
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
