import Foundation

// POST /api/v1/leagues/:id/lineup and POST /api/v1/espn/write-consent (server: APE-381,
// src/app/api/v1/leagues/[id]/lineup/route.ts and src/lib/server/v1/lineup.ts). The app sends the
// lineup it wants; the server works out the moves and words every change.

/// The lineup the app wants on ESPN, seat for seat with `SeasonLineup.seats`.
struct LineupRequest: Encodable, Equatable, Sendable {
    struct Seat: Encodable, Equatable, Sendable {
        let playerId: Int
        let slot: String
    }

    let week: Int
    let season: Int
    /// The user's roster as the season read had it: the server stops if ESPN has changed since.
    let snapshot: [Seat]
    /// Who sits in each seat; null (sent as JSON null) leaves it empty. Anyone not named goes to the bench.
    let lineup: [Int?]
    /// Everyone who should be on IR (APE-386): moving a player on or off IR is a change like any other.
    let ir: [Int]
    /// The ids of the changes to make; all of them when nil.
    let changes: [String]?
}

/// `?dryRun=1`: each change the lineup makes, in plain words, and why the ticked ones can't go.
struct LineupDryRun: Codable, Equatable, Sendable {
    struct Change: Codable, Equatable, Sendable, Identifiable {
        let id: String
        /// "Start Jaylen Waddle at WR, bench Tee Higgins".
        let text: String
        let picked: Bool
    }

    let changes: [Change]
    let problems: [String]
}

/// After the write: each change sent, and whether ESPN shows it.
struct LineupApplied: Codable, Equatable, Sendable {
    struct Change: Codable, Equatable, Sendable, Identifiable {
        let id: String
        let text: String
        let landed: Bool
        /// "Done on ESPN.", or what didn't land, in plain words.
        let result: String
    }

    let changes: [Change]
    let lockIn: LockInMoment?

    var allLanded: Bool { changes.allSatisfy(\.landed) }
}

/// The Lock In moment (the web's LockIn.tsx): what War Room's moves banked. Gains are projections.
struct LockInMoment: Codable, Equatable, Sendable {
    struct Move: Codable, Equatable, Sendable, Identifiable {
        let playerId: Int
        /// "Javonte Williams in at RB".
        let text: String
        let gain: Double
        /// The user's own call, not War Room's.
        let own: Bool

        var id: Int { playerId }
    }

    let banked: Double
    let before: Double
    let after: Double
    /// What War Room's lineup would still add.
    let leftover: Double
    /// rest, trim, gain, swing or must: the moment's size.
    let level: String
    let headline: String
    let confetti: Bool
    let moves: [Move]
}

struct ConsentRequest: Encodable, Sendable {
    let version: Int
}

/// POST /api/v1/espn/write-consent
struct ConsentGrant: Codable, Equatable, Sendable {
    let version: Int
    let agreed: Bool
}
