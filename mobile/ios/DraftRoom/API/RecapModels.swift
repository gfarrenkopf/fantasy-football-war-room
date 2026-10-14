import Foundation

// GET /api/v1/leagues/:id/recaps and /recaps/:week (server: src/lib/server/v1/recaps.ts, APE-383):
// the league's recap archive, told as the web's RecapArchive.tsx tells it. Only the fields the app
// reads are declared; the decoder ignores the rest, and fields added later are optional.

/// The archive: every kept week, newest first.
struct RecapsResponse: Codable, Equatable, Sendable {
    let league: SeasonResponse.LeagueRef
    /// Seasons with a kept week, newest first.
    let seasons: [Int]
    let weeks: [RecapSummary]

    /// A season's weeks, newest first.
    func weeks(in season: Int) -> [RecapSummary] {
        weeks.filter { $0.season == season }.sorted { $0.week > $1.week }
    }
}

/// The user's result in a kept week.
struct RecapResult: Codable, Equatable, Sendable {
    let result: WeekRecap.Outcome
    let me: Double
    let them: Double
    let opponent: String
}

/// Which week of which season: how a recap is asked for, and how the reader is pushed.
struct RecapKey: Hashable, Codable, Sendable {
    let season: Int
    let week: Int
}

/// A kept week as the archive lists it.
struct RecapSummary: Codable, Equatable, Sendable, Identifiable {
    let season: Int
    let week: Int
    /// The week in a line: the story's first line, or "Bye week".
    let headline: String
    /// Null for a bye, or when ESPN didn't list the user's matchup.
    let mine: RecapResult?
    /// When the week was kept: the Wednesday ESPN's stat corrections settled it, or its last save before then.
    let date: Date
    /// ESPN's stat corrections are in; until then the numbers may still move.
    let settled: Bool

    var key: RecapKey { RecapKey(season: season, week: week) }
    var id: RecapKey { key }
}

/// One kept week in full.
struct RecapResponse: Codable, Equatable, Sendable {
    let league: SeasonResponse.LeagueRef
    let season: Int
    let week: Int
    let headline: String
    let mine: RecapResult?
    let date: Date
    let settled: Bool
    let recap: LeagueRecap
    /// How the user's matchup swung; null without one.
    let swing: WeekSwing?
    /// What the share card draws; null without a matchup.
    let card: WeekRecap?

    var key: RecapKey { RecapKey(season: season, week: week) }
}

/// The week as the whole league's story (src/lib/season/leagueRecap.ts).
struct LeagueRecap: Codable, Equatable, Sendable {
    struct MyWeek: Codable, Equatable, Sendable {
        let result: WeekRecap.Outcome
        let me: Double
        let them: Double
        let margin: Double
        let opponent: String
    }

    let week: Int
    let mine: MyWeek?
    let headline: String
    /// A few sentences on the user's week; empty without a matchup.
    let story: String
    let standings: [StandingRow]
    let topScorers: [RecapPlayer]
    /// The one performance that decided a matchup.
    let gameChanger: GameChanger?
    /// The most valuable benchwarmers: the best points left on a bench.
    let benchwarmers: [RecapPlayer]
    /// The starters who fell furthest short of ESPN's projection.
    let falseStarters: [RecapPlayer]
}

struct StandingRow: Codable, Equatable, Sendable, Identifiable {
    let teamId: Int
    let rank: Int
    let wins: Int
    let losses: Int
    let ties: Int
    let name: String
    let mine: Bool

    var id: Int { teamId }
    /// "3–1", or "3–1–1" with a tie.
    var record: String { "\(wins)–\(losses)\(ties > 0 ? "–\(ties)" : "")" }
}

/// A player in a recap list, the fantasy team he played for, and how far he ran from ESPN's projection.
struct RecapPlayer: Codable, Equatable, Sendable, Identifiable {
    let playerId: Int
    let name: String
    let pos: String
    let team: String?
    let slot: String
    let points: Double
    let projected: Double
    let teamId: Int
    let teamName: String
    /// Points over (or, negative, under) ESPN's projection.
    let gap: Double

    var id: Int { playerId }
}

struct GameChanger: Codable, Equatable, Sendable {
    struct Score: Codable, Equatable, Sendable {
        let his: Double
        let theirs: Double
    }

    let player: RecapPlayer
    /// His team's winning margin, smaller than his points over projection.
    let margin: Double
    let opponent: String
    let score: Score
}
