import Foundation

// GET /api/v1/leagues/:id/team/waivers and POST /api/v1/leagues/:id/team/acquire (server: APE-386,
// src/lib/server/v1/team.ts). The waiver wire the web's Waivers tab shows, and the add, claim or
// cancel that changes the user's roster on ESPN, worded by the server.

/// The waiver wire: pickups ranked by what they add to the user's best lineup for the rest of the
/// season, next week's holes with the players who'd fill them, and who the user could drop.
struct WaiversResponse: Codable, Equatable, Sendable {
    struct Claims: Codable, Equatable, Sendable {
        /// Draft Room claims in this league; it doesn't bid FAAB, and `reason` says so.
        let allowed: Bool
        let reason: String?
    }

    struct Drops: Codable, Equatable, Sendable {
        /// The roster is full, so an add needs a drop.
        let needed: Bool
        /// Who the user could drop, weakest first.
        let candidates: [Int]
    }

    let pickups: [Pickup]
    let ahead: [Ahead]
    /// How many of the wire's most-rostered players were weighed.
    let considered: Int
    let fetchedAt: Date
    /// "Waiver priority 4 of 12", or the FAAB left in a league that bids.
    let note: String?
    let claims: Claims
    let drops: Drops
}

/// A player on the wire worth adding: what he adds a week and for the rest of the season, and the
/// suggested drop.
struct Pickup: Codable, Equatable, Sendable, Identifiable {
    let player: ViewPlayer
    let delta: Double
    let perWeek: Double
    let drop: Int?

    var id: Int { player.playerId }
}

/// GET team/players (APE-409): a page of the league's available players matching a search, most
/// rostered first, each valued like a pickup.
struct PlayersResponse: Codable, Equatable, Sendable {
    let players: [Pickup]
    /// Another page follows: ask again with `offset` moved on by the players shown.
    let more: Bool
    let fetchedAt: Date
}

/// Next week's hole (the web's NextWeek, APE-353): a slot nobody can play that week, and who'd fill it.
struct Ahead: Codable, Equatable, Sendable, Identifiable {
    struct Hole: Codable, Equatable, Sendable {
        let week: Int
        let key: String
        /// Who holds the slot, when someone does; nil when nobody on the team can play it.
        let playerId: Int?
        /// "out", or "zero" when he projects nothing that week (most often a bye).
        let reason: String
    }

    struct Fill: Codable, Equatable, Sendable, Identifiable {
        let player: ViewPlayer
        let drop: Int?

        var id: Int { player.playerId }
    }

    let hole: Hole
    let fills: [Fill]

    var id: String { "\(hole.week)-\(hole.key)-\(hole.playerId.map(String.init) ?? "none")" }
}

/// An add, a claim or a claim's cancel, as the web's AcquireReview and ClaimList send them.
struct AcquireRequest: Encodable, Equatable, Sendable {
    enum Kind: String, Encodable, Sendable {
        case add, claim, cancel
    }

    let kind: Kind
    let week: Int
    var snapshot: [LineupRequest.Seat] = []
    var add: Int = 0
    /// Who goes to make room; sent as JSON null when nobody does.
    var drop: Int? = nil
    /// The claim to cancel.
    var claimId: String? = nil

    private enum CodingKeys: String, CodingKey {
        case kind, week, snapshot, add, drop, claimId
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kind, forKey: .kind)
        try c.encode(week, forKey: .week)
        if kind == .cancel {
            try c.encode(claimId, forKey: .claimId)
            return
        }
        try c.encode(snapshot, forKey: .snapshot)
        try c.encode(add, forKey: .add)
        try c.encode(drop, forKey: .drop) // the server wants the key, null or not
    }
}

/// `?dryRun=1` on a team write: what it does in plain words, and why it can't go to ESPN.
struct TeamDryRun: Codable, Equatable, Sendable {
    let text: String
    let problems: [String]
}

/// After a team write: whether ESPN shows it, and what to tell the user.
struct TeamApplied: Codable, Equatable, Sendable {
    let landed: Bool
    let result: String
}

// GET /api/v1/leagues/:id/team/fills and POST /api/v1/leagues/:id/team/fill (APE-404): this week's
// holes, the ranked ways to fill the hard ones, and the fill that runs their steps on ESPN.

/// This week's holes, and how to fill the hard ones (the web's season/fills).
struct FillsResponse: Codable, Equatable, Sendable {
    let holes: [Hole]
    let fills: [HoleFills]
}

/// One hole's ways to fill it: free agents to add now, best first, and claims that clear in time.
struct HoleFills: Codable, Equatable, Sendable {
    let hole: Hole
    let fills: [HoleFill]
    /// Claimed from Waivers, not here.
    let claims: [HoleFill]
}

/// One way to fill a hole: who to add, and how to make room for him.
struct HoleFill: Codable, Equatable, Sendable, Identifiable {
    let player: ViewPlayer
    /// Who to drop; nil when there's room, or IR makes it.
    let drop: Int?
    /// The hole's player, moved to IR first to make room.
    let ir: Int?

    var id: Int { player.playerId }
}

/// A hole and one of team/fills' ways to fill it; the server takes the drop and IR from there.
struct FillRequest: Encodable, Equatable, Sendable {
    struct HoleRef: Encodable, Equatable, Sendable {
        let key: String
        let playerId: Int?

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(key, forKey: .key)
            try c.encode(playerId, forKey: .playerId) // the server wants the key, null or not
        }

        private enum CodingKeys: String, CodingKey { case key, playerId }
    }

    let week: Int
    let season: Int
    let snapshot: [LineupRequest.Seat]
    let hole: HoleRef
    let add: Int
}

/// `?dryRun=1` on a fill: the fill and each step in plain words, and why it can't go.
struct FillDryRun: Codable, Equatable, Sendable {
    let text: String
    let steps: [String]
    let problems: [String]
}

/// After a fill: each step and whether ESPN shows it (nil for one never sent), what to tell the user,
/// and why the step that stopped it did.
struct FillApplied: Codable, Equatable, Sendable {
    struct Step: Codable, Equatable, Sendable {
        let text: String
        let landed: Bool?
    }

    let landed: Bool
    let result: String
    let steps: [Step]
    let details: [String]
}

// GET and POST /api/v1/leagues/:id/team/trades (APE-386, APE-405): the user's trades pending on
// ESPN, graded by the server, and proposing, accepting, declining or withdrawing one.

/// The user's trades pending on ESPN, and the trade deadline.
struct TradesResponse: Codable, Equatable, Sendable {
    struct Deadline: Codable, Equatable, Sendable {
        let at: Date?
        let passed: Bool
    }

    let offers: [TradeOffer]
    let deadline: Deadline
}

/// A trade pending on ESPN (the web's Offer): who, which way, graded, and what the user can do.
struct TradeOffer: Codable, Equatable, Sendable, Identifiable {
    struct Partner: Codable, Equatable, Sendable {
        let id: Int
        let name: String
    }

    struct When: Codable, Equatable, Sendable {
        /// "Expires" or "Goes through".
        let label: String
        let at: Date
    }

    let id: String
    /// theirs: offered to the user; mine: the user's own offer; accepted: agreed, waiting on the league.
    let kind: String
    let partner: Partner
    let gives: [Int]
    let gets: [Int]
    let when: When?
    /// Nil when it can't be graded: a player in it is no longer on those rosters.
    let grade: TradeGrade?
    /// accept, decline or withdraw.
    let actions: [String]
}

/// A trade graded for the user against both starting lineups for the rest of the season (the web's TradeGain).
struct TradeGrade: Codable, Equatable, Sendable {
    struct Slot: Codable, Equatable, Sendable {
        let key: String
        let change: Double
    }

    let headline: String
    /// rest, trim, gain, swing or must: how loudly to say it.
    let level: String
    /// Points a week for the user, and for the partner.
    let perWeek: Double
    let theirs: Double
    /// The user's change over the rest of the season.
    let delta: Double
    let weeks: Int
    let slots: [Slot]
    /// "You'd drop X to make room".
    let dropLines: [String]
    /// Who the user would cut; a proposal sends them.
    let drops: [Int]
}

/// A proposal, or an answer to an offer, as the web's TradeWrite sends them.
struct TradeRequest: Encodable, Equatable, Sendable {
    enum Kind: String, Encodable, Sendable {
        case propose, accept, decline, withdraw
    }

    let kind: Kind
    let week: Int
    /// The roster staged against: a proposal and an accept check it.
    var snapshot: [LineupRequest.Seat]? = nil
    var partner: Int? = nil
    var gives: [Int]? = nil
    var gets: [Int]? = nil
    var drops: [Int]? = nil
    var tradeId: String? = nil
}

/// `?dryRun=1` on a trade: the question in plain words, why it can't go, and, for a proposal, its grade.
struct TradeDryRun: Codable, Equatable, Sendable {
    let text: String
    let problems: [String]
    var grade: TradeGrade? = nil
}
