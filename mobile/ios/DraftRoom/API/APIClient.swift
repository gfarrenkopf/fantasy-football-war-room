import Foundation
import Observation

/// What can go wrong talking to the server, in the terms the UI shows.
enum APIError: Error, Equatable {
    /// 401: the session is gone. The client has already cleared it.
    case signedOut
    /// Any other error status, with the server's own message (`{ error }`) when it sent one.
    case server(status: Int, message: String)
    /// No answer: offline, timed out, or the server is down.
    case offline
    /// The answer wasn't the JSON this build expects.
    case unreadable

    /// A sentence the UI can show as it is.
    var message: String {
        switch self {
        case .signedOut: "You've been signed out. Sign in again to carry on."
        case let .server(_, message): message
        case .offline: "Can't reach Draft Room. Check your connection and try again."
        case .unreadable: "Draft Room sent something this version of the app can't read. Try updating the app."
        }
    }
}

/// The one way the app talks to the server: JSON over URLSession, with the session token from the
/// Keychain as `Authorization: Bearer`. Shared through the SwiftUI environment.
@MainActor
@Observable
final class APIClient {
    let baseURL: URL
    private let session: URLSession
    private let tokens: TokenStore
    /// Called after a 401 clears the token, so the app can return to sign-in.
    @ObservationIgnored var onSignedOut: (@MainActor () -> Void)?

    init(baseURL: URL, session: URLSession = .shared, tokens: TokenStore = KeychainTokenStore()) {
        self.baseURL = baseURL
        self.session = session
        self.tokens = tokens
    }

    var hasToken: Bool { tokens.token() != nil }

    /// Keeps a new session (after any sign-in), replacing the old one.
    func store(_ grant: SessionGrant) {
        tokens.setToken(grant.token)
    }

    /// Forgets the session on this device.
    func clearToken() {
        tokens.setToken(nil)
    }

    func get<Response: Decodable>(_ path: String, as _: Response.Type = Response.self) async throws(APIError) -> Response {
        try decode(await perform("GET", path, body: nil))
    }

    func post<Response: Decodable>(_ path: String, body: some Encodable, as _: Response.Type = Response.self) async throws(APIError) -> Response {
        try decode(await perform("POST", path, body: encode(body)))
    }

    /// For routes that answer 204 with no body.
    func send(_ method: String, _ path: String, body: some Encodable) async throws(APIError) {
        _ = try await perform(method, path, body: encode(body))
    }

    func send(_ method: String, _ path: String) async throws(APIError) {
        _ = try await perform(method, path, body: nil)
    }

    // MARK: -

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        // The server sends `toISOString()`, which has milliseconds; .iso8601 alone rejects them.
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = try? Date(raw, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) { return date }
            if let date = try? Date(raw, strategy: .iso8601) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not an ISO 8601 date: \(raw)"))
        }
        return decoder
    }()

    private func encode(_ body: some Encodable) throws(APIError) -> Data {
        do { return try JSONEncoder().encode(body) } catch { throw .unreadable }
    }

    private func decode<Response: Decodable>(_ data: Data) throws(APIError) -> Response {
        do { return try Self.decoder.decode(Response.self, from: data) } catch { throw .unreadable }
    }

    private func perform(_ method: String, _ path: String, body: Data?) async throws(APIError) -> Data {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token = tokens.token() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw .offline
        }
        guard let http = response as? HTTPURLResponse else { throw .unreadable }
        switch http.statusCode {
        case 200 ..< 300:
            return data
        case 401:
            // Only a request that carried a token means the session ended; a failed sign-in is a 401 too.
            if request.value(forHTTPHeaderField: "Authorization") != nil {
                clearToken()
                onSignedOut?()
                throw .signedOut
            }
            throw .server(status: 401, message: Self.message(in: data, status: 401))
        default:
            throw .server(status: http.statusCode, message: Self.message(in: data, status: http.statusCode))
        }
    }

    private static func message(in data: Data, status: Int) -> String {
        if let body = try? JSONDecoder().decode(ServerError.self, from: data), !body.error.isEmpty { return body.error }
        return status >= 500 ? "Draft Room hit a problem. Try again in a moment." : "That didn't work (\(status)). Try again."
    }
}
