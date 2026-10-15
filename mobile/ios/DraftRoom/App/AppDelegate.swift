import UIKit

/// The UIKit callbacks SwiftUI has no modifier for: the APNs device token.
final class AppDelegate: NSObject, UIApplicationDelegate {
    /// Set by the app once the session exists.
    @MainActor weak var push: PushRegistrar?

    func application(_: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in await push?.didRegister(deviceToken: deviceToken) }
    }

    func application(_: UIApplication, didFailToRegisterForRemoteNotificationsWithError _: Error) {
        // Expected on unsigned simulator builds, which have no push entitlement. Nothing to do.
    }
}
