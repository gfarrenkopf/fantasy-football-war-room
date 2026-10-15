import UIKit
import UserNotifications

/// The UIKit callbacks SwiftUI has no modifier for: the APNs device token, and notifications
/// arriving or tapped.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// Set by the app once the session exists.
    @MainActor weak var push: PushRegistrar?
    /// Set by the app once the session exists. A tap that launched the app waits until then.
    @MainActor weak var session: Session? {
        didSet {
            if let session, let link = pendingLink {
                session.seasonLink = link
                pendingLink = nil
            }
        }
    }

    @MainActor private var pendingLink: SeasonLink?

    func application(_: UIApplication, didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Set before launch ends, so a tap that launched the app is delivered.
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in await push?.didRegister(deviceToken: deviceToken) }
    }

    func application(_: UIApplication, didFailToRegisterForRemoteNotificationsWithError _: Error) {
        // Expected on unsigned simulator builds, which have no push entitlement. Nothing to do.
    }

    /// An alert arriving while the app is open still shows: it's usually about another league or tab.
    nonisolated func userNotificationCenter(_: UNUserNotificationCenter, willPresent _: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    /// A tapped alert opens what it's about: its league, on its tab.
    nonisolated func userNotificationCenter(_: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              let link = SeasonLink(push: response.notification.request.content.userInfo) else { return }
        await MainActor.run {
            if let session { session.seasonLink = link } else { pendingLink = link }
        }
    }
}
