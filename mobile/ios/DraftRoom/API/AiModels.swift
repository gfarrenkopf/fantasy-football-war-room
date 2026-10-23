import Foundation

// In-season AI (APE-390, server: src/lib/server/v1/ai.ts): the Lineup tab's AI lineup and the
// Trades tab's ideas and write-ups. The server writes every word and gates every feature; the app
// shows what it's sent. A locked league is told where the season pass is, never how to buy it.

/// GET /api/v1/leagues/:id/ai, and the answer to POST ai/lineup and ai/trade-ideas.
struct AiResponse: Codable, Equatable, Sendable {
    struct Access: Codable, Equatable, Sendable {
        /// unlocked, trial or locked.
        let state: String
        let trialWeek: Int?
        let trialWeeks: Int?
        /// "Free trial · week 2 of 5", or what a locked league is told.
        let note: String?

        var isLocked: Bool { state == "locked" }
    }

    let access: Access
    let week: Int
    /// The newest of this week's AI lineups; nil before one is written, and while locked.
    let lineup: AiLineup?
    /// write: none yet; rewrite: one is stored and the mid-week allowance is unused; nil: neither.
    let lineupAction: String?
    /// Said in place of the button once the mid-week lineup is used and none is stored.
    let lineupNote: String?
    let ideas: AiIdeas?
    /// Whether "Find trades" shows.
    let canFindIdeas: Bool
    /// From POST ai/trade-ideas: no trade cleared the bar, and nothing was used.
    let none: Bool?
}

struct AiPlayer: Codable, Equatable, Hashable, Sendable, Identifiable {
    let id: Int
    let name: String
}

/// This week's AI lineup, as the web's AI lineup card shows it.
struct AiLineup: Codable, Equatable, Sendable {
    struct Call: Codable, Equatable, Sendable {
        /// "FLEX", "D/ST".
        let slot: String
        let player: AiPlayer?
        let reason: String
    }

    struct Starter: Codable, Equatable, Sendable {
        /// The slot key, as the season response's seats name them.
        let key: String
        let playerId: Int?
        let locked: Bool
    }

    struct Espn: Codable, Equatable, Sendable {
        let matches: Bool
        let text: String
    }

    let intro: String
    let createdAt: Date
    let total: Double
    /// "Start X over Y at FLEX: a close call…", when the AI went the other way on one.
    let departures: String?
    let calls: [Call]
    let starters: [Starter]
    /// Whether ESPN starts these players now; once stale, that it's out of date.
    let espn: Espn
    /// The projections have moved under it since it was written (APE-439): its lineup no longer
    /// holds, and it can be written again for free. Missing from servers before it was sent.
    var stale: Bool?

    var isStale: Bool { stale == true }
}

/// One of this week's trade ideas, graded again against the rosters now.
struct AiIdea: Codable, Equatable, Sendable, Identifiable {
    /// safe or bold.
    let kind: String
    /// "Win-win" or "Bold swing".
    let label: String
    let partner: AiPlayer
    let gives: [AiPlayer]
    let gets: [AiPlayer]
    /// ok, stale, blocked or offered.
    let status: String
    let note: String?
    let grade: TradeGrade?
    let moved: String?
    let why: String
    let pitch: String
    let canOffer: Bool

    var id: String { kind }
    var isStale: Bool { status == "stale" }
    /// The user has offered it on ESPN, and it's pending there.
    var isOffered: Bool { status == "offered" }
}

struct AiIdeas: Codable, Equatable, Sendable {
    let createdAt: Date
    let ideas: [AiIdea]
    /// Why a kind is missing, in the web's words.
    let missing: [String]
}

/// POST ai/trade: the AI write-up of a trade.
struct AiWriteup: Codable, Equatable, Sendable {
    struct Counter: Codable, Equatable, Sendable {
        let give: [AiPlayer]
        let get: [AiPlayer]
        let note: String
        /// "Send X; ask for Y. Note."
        let text: String
    }

    /// accept, decline or counter.
    let lean: String
    let leanLabel: String
    let summary: String
    let reasons: [String]
    let counter: Counter?
    let createdAt: Date
}

/// POST ai/trade's body: a trade between the user's team and `partner`, by ESPN ids.
struct AiTradeRequest: Encodable, Equatable, Hashable, Sendable {
    let partner: Int
    let gives: [Int]
    let gets: [Int]
}
