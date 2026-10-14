import Foundation

// GET /api/v1/leagues/:id/season (server: src/lib/server/v1/season.ts, APE-379): what the web's
// Game day and Lineup tabs show, with every value the web derives already derived. The app draws
// it and never computes season math itself. Only the fields the app reads are declared; the
// decoder ignores the rest, and fields added later are optional.

struct SeasonResponse: Codable, Equatable, Sendable {
    struct LeagueRef: Codable, Equatable, Sendable {
        let id: String
        let name: String
    }

    let league: LeagueRef
    let fetchedAt: Date
    /// ESPN couldn't be reached, so this is an older read the server kept.
    let stale: Bool
    let projectionsMissing: Bool
    let phase: GameDayPhase
    /// The tab to open on a cold launch or a league switch.
    let defaultTab: String
    /// This week's league, as the Lineup tab reads it.
    let view: SeasonView
    /// Last week while its result is still up; Game day shows it instead of `view`.
    let result: SeasonView?
    let live: LiveMatchup?
    let gameDay: GameDay

    /// The league Game day shows.
    var gameDayView: SeasonView { result ?? view }
}

enum GameDayPhase: String, Codable, Sendable {
    case lineup, live, results
}

struct SeasonView: Codable, Equatable, Sendable {
    let name: String
    let season: Int
    let currentWeek: Int
    let myTeamId: Int
    let teams: [ViewTeam]

    func team(_ id: Int) -> ViewTeam? { teams.first { $0.id == id } }

    /// Every rostered player, by id.
    func player(_ id: Int) -> ViewPlayer? {
        for team in teams { if let p = team.roster.first(where: { $0.playerId == id }) { return p } }
        return nil
    }
}

struct ViewTeam: Codable, Equatable, Sendable, Identifiable {
    let id: Int
    let name: String
    let abbrev: String
    let roster: [ViewPlayer]
}

struct ViewPlayer: Codable, Equatable, Sendable, Identifiable {
    let playerId: Int
    let name: String
    /// QB, RB, WR, TE, K or DST.
    let pos: String
    /// His NFL team's abbreviation; null for a free agent.
    let team: String?
    /// Where he sits on ESPN: a starting slot, BN or IR.
    let slot: String
    let injuryStatus: String
    /// Points scored this week; null before his game.
    let actual: Double?
    /// Projected points this week.
    let points: Double
    let game: GameState?

    var id: Int { playerId }
}

struct GameState: Codable, Equatable, Sendable {
    struct Score: Codable, Equatable, Sendable {
        let team: Int
        let opponent: Int
    }

    /// pre, in or post.
    let state: String
    /// ESPN's clock text while the game is on, "8:12 - 2nd".
    let detail: String
    let opponent: String
    let home: Bool
    let kickoff: Date?
    let score: Score?
}

struct LiveSide: Codable, Equatable, Sendable {
    let teamId: Int
    let name: String
    let points: Double
    let projected: Double
    /// Starters still to finish.
    let left: Int
}

/// The user's matchup as the scoreboard tells it. Its shape is the Live Activity's too (APE-397).
struct LiveMatchup: Codable, Equatable, Sendable {
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

enum Pace: String, Codable, Sendable {
    case pre, behind, on, ahead, boom
}

struct PlayerPace: Codable, Equatable, Sendable {
    let pace: Pace
    /// How far through his game the clock is, 0–1, while it's on.
    let progress: Double?
}

struct Hole: Codable, Equatable, Sendable {
    let key: String
    let kind: String
    let reason: String
    let playerId: Int?
}

struct ProjectionCall: Codable, Equatable, Sendable {
    let projected: Double
    let actual: Double?
}

struct PlayerCall: Codable, Equatable, Sendable {
    let playerId: Int
    let projected: Double
    let actual: Double?
}

struct CallRecord: Codable, Equatable, Sendable {
    let weeks: Int
    let meanMiss: Double
    let meanBias: Double
}

struct EspnCall: Codable, Equatable, Sendable {
    let me: ProjectionCall?
    let them: ProjectionCall?
    let best: PlayerCall?
    let worst: PlayerCall?
    let season: CallRecord?
}

struct GameDay: Codable, Equatable, Sendable {
    struct SlotPair: Codable, Equatable, Sendable {
        let key: String
        let me: Int?
        let them: Int?
    }

    struct Seat: Codable, Equatable, Sendable {
        let key: String
        let playerId: Int?
    }

    struct Around: Codable, Equatable, Sendable {
        let home: LiveSide
        let away: LiveSide
        let left: Int
    }

    struct Bench: Codable, Equatable, Sendable {
        let playerIds: [Int]
        let points: Double
    }

    let week: Int
    let headToHead: [SlotPair]
    /// Without a matchup (a bye): the user's starters as set on ESPN.
    let starters: [Seat]
    /// Keyed by player id, as a string (JSON object keys).
    let pace: [String: PlayerPace]
    let around: [Around]
    let bench: Bench
    /// Hard holes: starting slots nobody on the roster can play.
    let holes: [Hole]
    let espnCall: EspnCall?
    let showArchive: Bool

    func pace(of playerId: Int) -> PlayerPace? { pace[String(playerId)] }
}

/// Slot and position names as ESPN shows them (the web's SLOT_LABEL and posLabel in parts.tsx).
enum SlotLabel {
    static func of(_ key: String) -> String {
        switch key {
        case "SUPERFLEX": "OP"
        case "DST": "D/ST"
        case "BN": "Bench"
        default: key
        }
    }
}
