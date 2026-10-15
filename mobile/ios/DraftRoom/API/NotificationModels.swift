import Foundation

/// How a season alert reaches the user (21.3).
enum AlertChannel: String, Codable, CaseIterable, Sendable {
    case email, push, both, off

    var label: String {
        switch self {
        case .email: "Email"
        case .push: "iPhone"
        case .both: "Email and iPhone"
        case .off: "Off"
        }
    }

    var pushes: Bool { self == .push || self == .both }
}

/// GET/PUT /api/v1/notifications (src/lib/server/v1/notifications.ts).
struct NotificationSettings: Decodable, Equatable, Sendable {
    struct Alert: Decodable, Equatable, Identifiable, Sendable {
        let kind: String
        let title: String
        let detail: String
        var channel: AlertChannel
        /// There's no email for it (the lineup reminder), so it's iPhone or off.
        let pushOnly: Bool
        var id: String { kind }
    }

    var alerts: [Alert]
    /// The server sends email and the account has an address.
    let email: Bool
    /// The server sends push notifications.
    let push: Bool
    /// The server has a signed-in iPhone for this account.
    let hasDevice: Bool

    /// The choices that do something here: email ones only when email works, iPhone ones only when push does.
    func choices(for alert: Alert) -> [AlertChannel] {
        AlertChannel.allCases.filter { c in
            c == alert.channel || c == .off || (c == .push && push)
                || (!alert.pushOnly && ((c == .email && email) || (c == .both && email && push)))
        }
    }
}
