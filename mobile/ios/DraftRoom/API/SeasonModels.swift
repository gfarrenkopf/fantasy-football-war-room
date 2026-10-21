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
    /// The Lineup tab: ESPN's lineup and War Room's, seat for seat, and who may sit where.
    let lineup: SeasonLineup
    /// The ESPN write consent: the text, its version, and whether the user has agreed to it.
    let consent: WriteConsent

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
    /// The league's IR slots; nil from a read cached before the app knew of them (APE-387).
    var irSlots: Int? = nil
    /// The user's fantasy matchup this week, in ESPN's numbers; null on a bye.
    let matchup: Matchup?
    /// The moves War Room got onto ESPN this week, for players still in that slot.
    let warRoomMoves: [WarRoomMove]
    /// The user's waiver claims pending on ESPN; nil from a read cached before the app knew of them (APE-389).
    var claims: [PendingClaim]? = nil

    func team(_ id: Int) -> ViewTeam? { teams.first { $0.id == id } }

    /// Every rostered player, by id.
    func player(_ id: Int) -> ViewPlayer? {
        for team in teams { if let p = team.roster.first(where: { $0.playerId == id }) { return p } }
        return nil
    }
}

/// A waiver claim of the user's, pending on ESPN (the web's ViewClaim).
struct PendingClaim: Codable, Equatable, Sendable, Identifiable {
    struct Player: Codable, Equatable, Sendable {
        let playerId: Int
        let name: String
        let pos: String?
        let team: String?
    }

    let id: String
    let add: Player
    /// Who goes if the claim succeeds.
    let drop: Int?
    /// When ESPN processes it; nil when ESPN didn't say.
    let processesAt: Date?
}

/// One side of the user's matchup as ESPN reports it (the web's MatchupSide).
struct MatchupSide: Codable, Equatable, Sendable {
    let teamId: Int
    let points: Double
    /// ESPN's projection for the lineup as set on ESPN, live-adjusted once games start.
    let projected: Double
    /// ESPN's chance this side wins, 0–1.
    let winProbability: Double?
}

struct Matchup: Codable, Equatable, Sendable {
    let me: MatchupSide
    let them: MatchupSide
}

/// A move War Room made on ESPN this week, and what it gained (the "Started by Draft Room" marker).
struct WarRoomMove: Codable, Equatable, Sendable, Identifiable {
    let playerId: Int
    let slot: String
    let gain: Double

    var id: Int { playerId }
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
    /// His game has started, so ESPN won't move him this week.
    let locked: Bool
    /// Points scored this week; null before his game.
    let actual: Double?
    /// Projected points this week.
    let points: Double
    /// The stats behind `actual`, ESPN-style ("329 YDS, 2 TD"); null until his game starts.
    var statLine: String? = nil
    let game: GameState?
    /// Projected points for the rest of the season.
    var ros: Double? = nil
    /// Projected points by week, keyed by week number as a string; on the waiver wire's players.
    var weekly: [String: Double]? = nil
    /// FREEAGENT or WAIVERS, for a player on the wire.
    var status: String? = nil
    /// When a player on waivers clears.
    var waiverClears: Date? = nil
    /// How widely he's rostered and started across ESPN, in percent; orders the free-agent search (APE-413).
    var ownership: Ownership? = nil

    struct Ownership: Codable, Equatable, Sendable {
        let owned: Int
        let started: Int
    }

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
    /// hard (nobody can play the slot) or soft (a doubtful or likely-out starter with no backup).
    let kind: String
    /// out, bye, empty, likely-out or doubtful.
    let reason: String
    let playerId: Int?
    /// The slot's player's kickoff; null on a bye or for an empty slot.
    var kickoff: Date? = nil
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
    /// The decided week (phase results): the result and how the week swung.
    var result: WeekResult? = nil
    /// ESPN's season on the user's team, between weeks.
    var trackRecord: TrackRecord? = nil
    /// Last week's final, between weeks, until the recap archive tells it.
    var lastWeek: WeekRecap? = nil

    func pace(of playerId: Int) -> PlayerPace? { pace[String(playerId)] }
}

struct WeekResult: Codable, Equatable, Sendable {
    let recap: WeekRecap
    let swing: WeekSwing?
}

/// The week told as a result (src/lib/season/recap.ts): the final, the margin, the user's starters
/// as they scored, and the star of the week.
struct WeekRecap: Codable, Equatable, Sendable {
    enum Outcome: String, Codable, Sendable {
        case win, loss, tie
    }

    struct Starter: Codable, Equatable, Sendable, Identifiable {
        let slot: String
        let playerId: Int
        let name: String
        let pos: String
        let team: String?
        let points: Double
        /// ESPN's call before kickoff when it was recorded, otherwise the projection.
        let projected: Double

        var id: Int { playerId }
    }

    struct Star: Codable, Equatable, Sendable {
        let player: Starter
        /// He beat his projection; otherwise he's simply the top scorer.
        let beat: Bool
    }

    let week: Int
    let result: Outcome
    let me: Double
    let them: Double
    let margin: Double
    let opponent: String
    let starters: [Starter]
    let star: Star?
}

/// Why the week went the way it did (src/lib/season/swing.ts): ESPN's margin before kickoff, the
/// players who moved it, and the rest, adding up to the final.
struct WeekSwing: Codable, Equatable, Sendable {
    struct Swing: Codable, Equatable, Sendable, Identifiable {
        let playerId: Int
        let name: String
        let pos: String
        /// me or them: whose starter he was.
        let side: String
        let points: Double
        let projected: Double
        /// What he did to the user's margin.
        let delta: Double
        let before: Double
        let after: Double

        var id: Int { playerId }
    }

    struct Rest: Codable, Equatable, Sendable {
        let delta: Double
        let before: Double
        let after: Double
    }

    struct Hindsight: Codable, Equatable, Sendable {
        struct Best: Codable, Equatable, Sendable {
            let name: String
            let points: Double
        }

        let total: Double
        let gain: Double
        let wouldHaveWon: Bool
        let best: Best?
    }

    let projected: Double
    let final: Double
    let swings: [Swing]
    let rest: Rest?
    /// Each side's starters against their projections, signed for the user.
    let mine: Double
    let theirs: Double
    /// The user's starters projected for nothing who scored nothing.
    let empty: [String]
    let hindsight: Hindsight?
}

/// ESPN's season on the user's team (the web's TrackRecord): its miss, its lean, how often it
/// called the team too high, and the players it has read most and least closely.
struct TrackRecord: Codable, Equatable, Sendable {
    struct Player: Codable, Equatable, Sendable {
        let playerId: Int
        let weeks: Int
        let meanMiss: Double
        let meanBias: Double
    }

    let weeks: Int
    let meanMiss: Double
    let meanBias: Double
    let overcalled: Int
    let surest: Player
    let shakiest: Player
}

/// The Lineup tab's data (the server's `lineup`, src/lib/server/v1/season.ts).
struct SeasonLineup: Codable, Equatable, Sendable {
    struct Tag: Codable, Equatable, Sendable {
        /// OUT, BYE, LIKELY OUT.
        let label: String
        /// out or warn.
        let kind: String
    }

    /// One of War Room's suggested changes against ESPN's lineup (the web's StartSitSwap).
    struct Swap: Codable, Equatable, Sendable {
        let key: String
        /// Who starts; null leaves the slot empty.
        let into: Int?
        /// Who comes out; null when the slot is empty on ESPN.
        let out: Int?
        let gain: Double
        /// Why the benched player comes out, when it's news.
        let tag: Tag?
    }

    struct StartSit: Codable, Equatable, Sendable {
        /// rest, trim, gain, swing or must: how loudly the hero speaks (the web's lineupEmphasis).
        let level: String
        let headline: String
        /// Projected points of War Room's lineup over ESPN's.
        let gain: Double
        /// War Room's lineup's projected total, and ESPN's.
        let total: Double
        let currentTotal: Double
        /// War Room's changes, slot by slot; empty when ESPN already has its lineup.
        let swaps: [Swap]
        /// What War Room's moves have already gained this week.
        let banked: Double
    }

    /// Every starting seat in order: RB twice for two RBs.
    let seats: [String]
    /// Who sits in each seat on ESPN now, and in War Room's lineup; null for an empty seat.
    let onEspn: [Int?]
    let recommended: [Int?]
    /// The slots each of the user's players may move to, keyed by player id as a string.
    let eligible: [String: [String]]
    /// Why a player would come out, when it's news; keyed by player id as a string.
    let tags: [String: Tag]
    let startSit: StartSit
    let holes: [Hole]

    func canPlay(_ playerId: Int, _ slot: String) -> Bool { eligible[String(playerId)]?.contains(slot) == true }
    func tag(of playerId: Int) -> Tag? { tags[String(playerId)] }
}

/// The consent to change the user's team on ESPN (Epic 13). The text always comes from the server.
struct WriteConsent: Codable, Equatable, Sendable {
    let version: Int
    let lines: [String]
    let agreed: Bool
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
