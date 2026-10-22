import Foundation

// The JSON shapes of /api/v1 (server: src/app/api/v1/). A v1 route only ever gains fields, so
// every type here decodes with unknown keys ignored, and new fields are optional.

struct User: Codable, Equatable, Sendable {
    let id: String
    let email: String?
    let name: String?
}

/// Every sign-in exchange answers with this (src/lib/server/appAuthRoutes.ts, sessionResponse()).
struct SessionGrant: Codable, Equatable, Sendable {
    let token: String
    let expiresAt: Date
    let user: User
    let isNew: Bool?
}

/// GET /api/v1/me
struct Me: Codable, Equatable, Sendable {
    struct Flags: Codable, Equatable, Sendable {
        let season: Bool
        let ai: Bool
        let payments: Bool
    }

    let user: User
    let flags: Flags
    let minAppVersion: String
    /// App Review's account (APE-398): Settings shows it the sample alert and Live Activity.
    let review: Bool?
}

/// POST /api/v1/auth/email/start: no body when a link went out, `{ step: "code" }` for App Review's account.
struct EmailStart: Codable, Sendable {
    let step: String?
}

/// The server's error body: `{ "error": "..." }`.
struct ServerError: Codable, Sendable {
    struct Consent: Codable, Sendable {
        let version: Int
        let lines: [String]
    }

    let error: String
    /// Why ESPN couldn't be read, on a 409 from the season routes.
    var problem: String? = nil
    /// An ESPN write's 409s (src/lib/server/espn/writeRoute.ts): the consent to agree to first, or why nothing was sent.
    var consent: Consent? = nil
    var changed: [String]? = nil
    var problems: [String]? = nil
    var refused: [String]? = nil
}

// MARK: ESPN (/api/v1/espn)

/// GET /api/v1/espn/disclosure: the web's own consent text and version.
struct EspnDisclosure: Codable, Equatable, Sendable {
    let version: Int
    let points: [String]
}

/// The two ESPN cookies, read from the sign-in web view. Held in memory only, until sent.
struct EspnLogin: Codable, Equatable, Sendable {
    let espnS2: String
    let swid: String
}

/// One of the user's ESPN fantasy football leagues (POST /api/v1/espn/leagues).
struct EspnLeagueChoice: Codable, Equatable, Hashable, Sendable, Identifiable {
    let espnLeagueId: String
    let name: String
    let season: Int
    let espnTeamId: Int
    let teamName: String?

    var id: String { "\(season):\(espnLeagueId)" }
}

struct EspnLeagueList: Codable, Sendable {
    let leagues: [EspnLeagueChoice]
}

/// POST /api/v1/espn/connect
struct EspnConnected: Codable, Equatable, Sendable {
    let leagueId: String
    let created: Bool
}

/// GET /api/v1/espn/login
struct EspnLoginStatus: Codable, Equatable, Sendable {
    struct Login: Codable, Equatable, Sendable {
        let status: String
        let season: Int
    }

    let login: Login?
}

/// One of the user's in-season leagues (GET /api/v1/leagues).
struct League: Codable, Equatable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
    let espnLeagueId: String
    let espnTeamId: Int
    let season: Int
}

struct LeagueList: Codable, Sendable {
    let leagues: [League]
}
