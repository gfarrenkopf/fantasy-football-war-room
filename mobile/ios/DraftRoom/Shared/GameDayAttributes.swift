import ActivityKit
import Foundation

/// The Game day Live Activity (21.5): one league's matchup on the lock screen and in the Dynamic
/// Island. The server names this type in push-to-start (LIVE_ATTRIBUTES_TYPE in
/// src/lib/server/liveActivities.ts) and sends these fields as its `attributes`.
struct GameDayAttributes: ActivityAttributes {
    typealias ContentState = LiveMatchup

    let leagueId: String
    let league: String

    /// Where a tap on the activity goes: the league's Game day.
    var url: URL { URL(string: "draftroom://season/\(leagueId)?tab=gameday")! }
}
