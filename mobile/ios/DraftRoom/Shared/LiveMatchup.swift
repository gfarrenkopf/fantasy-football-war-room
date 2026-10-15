import Foundation

// Shared by the app and the DraftRoomWidgets extension (the Game day Live Activity, 21.5): the
// project file adds this file to both targets.

struct LiveSide: Codable, Hashable, Sendable {
    let teamId: Int
    let name: String
    let points: Double
    let projected: Double
    /// Starters still to finish.
    let left: Int
}

/// The user's matchup as the scoreboard tells it (src/lib/season/liveMatchup.ts). It's the Live
/// Activity's content state too (APE-397), pushed by the server's live job, so both decode one shape.
struct LiveMatchup: Codable, Hashable, Sendable {
    let week: Int
    /// "Live", "Final", "3 left for Rivals", "5 to play" or "Up next".
    let status: String
    let live: Bool
    /// A starter on either side has kicked off; before then the projections are the numbers.
    let started: Bool
    let decided: Bool
    /// The user's points less their opponent's.
    let lead: Double
    /// ESPN's chance the user wins, as a whole percent.
    let win: Int?
    let me: LiveSide
    let them: LiveSide
}

/// The scoreboard's numbers in words, for the app and the Live Activity alike.
enum LiveFormat {
    /// Points as the web shows them: one decimal.
    static func points(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(1))) }

    /// "Up 4.5", "Down 2.0", "Tied", "Won by 12.3"; "vs" before kickoff.
    static func lead(_ lead: Double, started: Bool, decided: Bool) -> String {
        if abs(lead) < 0.05 { return started ? "Tied" : "vs" }
        let word = lead > 0 ? (decided ? "Won by" : "Up") : (decided ? "Lost by" : "Down")
        return "\(word) \(points(abs(lead)))"
    }
}
