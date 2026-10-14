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

/// An add or a claim, as the web's AcquireReview sends it.
struct AcquireRequest: Encodable, Equatable, Sendable {
    enum Kind: String, Encodable, Sendable {
        case add, claim
    }

    let kind: Kind
    let week: Int
    let snapshot: [LineupRequest.Seat]
    let add: Int
    /// Who goes to make room; sent as JSON null when nobody does.
    let drop: Int?

    private enum CodingKeys: String, CodingKey {
        case kind, week, snapshot, add, drop
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kind, forKey: .kind)
        try c.encode(week, forKey: .week)
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
