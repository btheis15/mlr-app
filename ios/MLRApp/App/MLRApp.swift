import SwiftUI
import AppIntents

@main
struct MLRApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var env = AppEnvironment()
    @State private var appearance = AppearanceManager.shared

    init() {
        // Make the in-app navigation router available to App Intents (Siri /
        // Shortcuts) so an opened intent can drive tab selection + sheets.
        AppDependencyManager.shared.add(dependency: IntentRouter.shared)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(env)
                .environment(appearance)
                // Follows the system appearance by default; honors a per-device
                // override (System / Light / Dark) from Profile → Appearance.
                .preferredColorScheme(appearance.appearance.colorScheme)
                .task {
                    await env.authService.restoreSession()
                    if env.authService.isSignedIn {
                        await env.loadProfile()
                        await env.pushService.reconcileToken()
                    }
                }
        }
    }
}

// MARK: - App Delegate (APNs token registration)

class AppDelegate: NSObject, UIApplicationDelegate {
    static var apnsToken: String?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // APNs registration happens via PushService when the user enables push;
        // pre-register here so the system is ready.
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
        // Actionable categories (RSVP / On my way / Reply / Birthday).
        UNUserNotificationCenter.current().registerMLRCategories()
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        AppDelegate.apnsToken = token
        NotificationCenter.default.post(name: .apnsTokenReceived, object: token)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("[APNs] Registration failed: \(error)")
    }
}

// MARK: - Notification Delegate

class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()

    // Show notifications even when the app is in the foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    // Handle tap on a notification
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        var userInfo = response.notification.request.content.userInfo

        // An action button was tapped (RSVP / On my way / Reply / Birthday).
        if response.actionIdentifier != UNNotificationDefaultActionIdentifier,
           response.actionIdentifier != UNNotificationDismissActionIdentifier {
            // Capture inline "Reply" text if present.
            if let textResponse = response as? UNTextInputNotificationResponse {
                userInfo["reply_text"] = textResponse.userText
            }
            let actionId = response.actionIdentifier
            let info = userInfo
            Task { @MainActor in
                await NotificationActionHandler.handle(actionId: actionId, userInfo: info)
                completionHandler()
            }
            return
        }

        // Plain tap on the notification body → deep-link into the app.
        if let targetType = userInfo["target_type"] as? String,
           let targetId = userInfo["target_id"] as? String {
            NotificationCenter.default.post(
                name: .notificationTapped,
                object: nil,
                userInfo: ["target_type": targetType, "target_id": targetId]
            )
        }
        completionHandler()
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let apnsTokenReceived  = Notification.Name("apnsTokenReceived")
    static let notificationTapped = Notification.Name("notificationTapped")
}
