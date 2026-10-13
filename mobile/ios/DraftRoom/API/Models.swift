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
}

/// The server's error body: `{ "error": "..." }`.
struct ServerError: Codable, Sendable {
    let error: String
}
