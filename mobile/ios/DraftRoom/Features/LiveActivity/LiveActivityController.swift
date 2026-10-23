import ActivityKit
import Foundation
import Observation

/// Starts, follows and stops the Game day Live Activity (21.5), and hands its APNs tokens to the
/// server, which pushes each new score (src/lib/server/liveActivities.ts).
///
/// - "Follow live" on Game day starts one for that league, then registers its update token.
/// - An activity the server started with push-to-start ("Follow live" turned on in Notifications)
///   shows up in `activityUpdates`; its token is registered the same way.
/// - The push-to-start token goes to the server with the device token (PushRegistrar).
/// - While the app is open, Game day's own reads update the activity too, so it never lags the app.
@MainActor
@Observable
final class LiveActivityController {
    private let api: APIClient
    /// Leagues with an activity running, so Game day can show "Following live".
    private(set) var following: Set<String> = []
    @ObservationIgnored private var watched: Set<String> = []
    @ObservationIgnored private var started = false
    /// Sends the push-to-start token on to the server, with the device token.
    @ObservationIgnored var onStartToken: ((String) -> Void)?

    init(api: APIClient) {
        self.api = api
    }

    /// Whether the user allows Live Activities for the app.
    var enabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    /// On each signed-in launch: pick up running activities and any the server starts.
    func start() {
        guard !started else { return }
        started = true
        for activity in Activity<GameDayAttributes>.activities { watch(activity) }
        Task { [weak self] in
            for await activity in Activity<GameDayAttributes>.activityUpdates { self?.watch(activity) }
        }
        Task { [weak self] in
            for await token in Activity<GameDayAttributes>.pushToStartTokenUpdates { self?.onStartToken?(Self.hex(token)) }
        }
    }

    func isFollowing(_ leagueId: String) -> Bool { following.contains(leagueId) }

    /// "Follow live": the league's matchup on the lock screen until the week is decided.
    func follow(leagueId: String, league: String, live: LiveMatchup) {
        guard !isFollowing(leagueId), enabled else { return }
        let attributes = GameDayAttributes(leagueId: leagueId, league: league)
        let content = ActivityContent(state: live, staleDate: Date.now.addingTimeInterval(10 * 60))
        // A build without the push entitlement (the simulator, unsigned) can't take a push token:
        // the activity then follows the app's own reads only.
        let activity = (try? Activity.request(attributes: attributes, content: content, pushType: .token))
            ?? (try? Activity.request(attributes: attributes, content: content, pushType: nil))
        if let activity { watch(activity) }
    }

    /// Ends the league's activity on the phone and stops the server's pushes.
    func stop(leagueId: String) async {
        for activity in Activity<GameDayAttributes>.activities where activity.attributes.leagueId == leagueId {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    /// Game day read a new score while the app is open: show it at once, without waiting for a push.
    /// The same score goes again once half its stale window has passed, so it doesn't say "Not updating".
    func update(leagueId: String, live: LiveMatchup) async {
        for activity in Activity<GameDayAttributes>.activities where activity.attributes.leagueId == leagueId && (activity.content.state != live || Self.dueForRefresh(activity.content)) {
            let content = ActivityContent(state: live, staleDate: Date.now.addingTimeInterval(10 * 60))
            if live.decided { await activity.end(content, dismissalPolicy: .after(.now.addingTimeInterval(2 * 60 * 60))) } else { await activity.update(content) }
        }
    }

    private static func dueForRefresh(_ content: ActivityContent<LiveMatchup>) -> Bool {
        guard let staleDate = content.staleDate else { return false }
        return staleDate.timeIntervalSinceNow < 5 * 60
    }

        private func watch(_ activity: Activity<GameDayAttributes>) {
        guard !watched.contains(activity.id) else { return }
        watched.insert(activity.id)
        let leagueId = activity.attributes.leagueId
        if activity.activityState == .active { following.insert(leagueId) }
        Task { [weak self] in
            for await token in activity.pushTokenUpdates {
                await self?.register(leagueId: leagueId, token: Self.hex(token), week: activity.content.state.week)
            }
        }
        Task { [weak self] in
            for await state in activity.activityStateUpdates {
                guard let self else { return }
                if state == .active { following.insert(leagueId) } else { following.remove(leagueId) }
                // Ended on the phone: tell the server to stop pushing to it.
                if state == .dismissed || state == .ended {
                    if let token = activity.pushToken.map(Self.hex) { try? await api.send("DELETE", "api/v1/leagues/\(leagueId)/live-activity/\(token)") }
                    return
                }
            }
        }
    }

    private func register(leagueId: String, token: String, week: Int) async {
        struct Body: Encodable {
            let token: String
            let environment: String
            let week: Int
        }
        try? await api.send("POST", "api/v1/leagues/\(leagueId)/live-activity", body: Body(token: token, environment: PushRegistrar.environment, week: week))
    }

    nonisolated static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
}
