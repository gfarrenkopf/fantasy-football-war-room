import Foundation
import Observation

/// The Notifications screen in Settings (21.3): each season alert and how it reaches the user,
/// the same list as the web's account menu. A change shows at once and is saved in the background,
/// going back if the save fails.
@MainActor
@Observable
final class NotificationsModel {
    enum Load: Equatable {
        case loading
        case ready
        case failed(String)
    }

    private(set) var load: Load = .loading
    private(set) var settings: NotificationSettings?
    private(set) var errorMessage: String?
    private let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    func start() async {
        do {
            settings = try await api.get("api/v1/notifications")
            load = .ready
        } catch {
            if settings == nil { load = .failed(error.message) }
        }
    }

    func choose(_ channel: AlertChannel, for kind: String) async {
        guard var next = settings, let i = next.alerts.firstIndex(where: { $0.kind == kind }), next.alerts[i].channel != channel else { return }
        let before = settings
        next.alerts[i].channel = channel
        settings = next
        errorMessage = nil
        do {
            settings = try await api.put("api/v1/notifications", body: ["alerts": [kind: channel.rawValue]])
        } catch {
            settings = before
            errorMessage = error.message
        }
    }

    /// Some alert is set to reach the iPhone, so iOS has to allow notifications.
    var wantsPush: Bool { settings?.alerts.contains { $0.channel.pushes } ?? false }
}
