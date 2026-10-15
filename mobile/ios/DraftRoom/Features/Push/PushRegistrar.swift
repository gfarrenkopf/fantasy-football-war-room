import Foundation
import Observation
import UIKit
import UserNotifications

/// What the registrar needs from iOS, so tests can stand in for it.
@MainActor
protocol PushSystem {
    func authorizationStatus() async -> UNAuthorizationStatus
    /// Shows the system prompt; true when the user allowed notifications.
    func requestAuthorization() async -> Bool
    /// Asks APNs for a device token, which arrives through the app delegate.
    func registerForRemoteNotifications()
}

/// The real thing: UNUserNotificationCenter and UIApplication.
struct SystemPush: PushSystem {
    func authorizationStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func requestAuthorization() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    func registerForRemoteNotifications() {
        UIApplication.shared.registerForRemoteNotifications()
    }
}

/// Does nothing: the UI-test stub, where a permission prompt would block the tests.
struct NoPush: PushSystem {
    func authorizationStatus() async -> UNAuthorizationStatus { .denied }
    func requestAuthorization() async -> Bool { false }
    func registerForRemoteNotifications() {}
}

/// Gets this iPhone's APNs device token to the server, so the season alerts can reach it (21.1).
///
/// - Permission is asked once, at a moment that explains it: right after a league connects, not on
///   first launch.
/// - Once allowed, every signed-in launch registers again and sends the token, because tokens change.
/// - Signing out needs nothing here: the server drops the token with the app session.
@MainActor
@Observable
final class PushRegistrar {
    private let api: APIClient
    private let system: PushSystem
    private let appVersion: String
    /// The token last sent in this run, so a repeat from APNs isn't sent twice.
    @ObservationIgnored private var sent: String?

    init(api: APIClient, system: PushSystem, appVersion: String = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0") {
        self.api = api
        self.system = system
        self.appVersion = appVersion
    }

    /// Xcode builds get sandbox tokens; TestFlight and App Store builds (Release) get production ones.
    static var environment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    /// On each signed-in launch: register again if the user has allowed notifications.
    func refresh() async {
        sent = nil
        switch await system.authorizationStatus() {
        case .authorized, .provisional, .ephemeral: system.registerForRemoteNotifications()
        default: break
        }
    }

    /// Whether iOS lets the app show notifications.
    func authorizationStatus() async -> UNAuthorizationStatus {
        await system.authorizationStatus()
    }

    /// After a league connects: ask, the first time only.
    func askOnce() async {
        guard await system.authorizationStatus() == .notDetermined else { return }
        if await system.requestAuthorization() { system.registerForRemoteNotifications() }
    }

    /// APNs answered with this device's token.
    func didRegister(deviceToken: Data) async {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        guard token != sent else { return }
        struct Body: Encodable {
            let token: String
            let environment: String
            let appVersion: String
        }
        do {
            try await api.send("POST", "api/v1/devices", body: Body(token: token, environment: Self.environment, appVersion: appVersion))
            sent = token
        } catch {
            // Best effort: the next launch sends it again.
        }
    }
}
