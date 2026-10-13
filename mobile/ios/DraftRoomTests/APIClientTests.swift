import Foundation
import Testing

@testable import DraftRoom

/// Every suite that answers requests through StubURLProtocol, whose reply is shared state, so they
/// run one test at a time instead of in parallel.
@Suite(.serialized)
enum StubbedNetwork {}

extension StubbedNetwork {
    @MainActor
    @Suite
    struct APIClientTests {
        let tokens = MemoryTokenStore()
        let api: APIClient

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = nil
            api = APIClient(
                baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(),
                tokens: tokens)
        }

        @Test func decodesASessionGrantWithMillisecondDates() async throws {
            StubURLProtocol.reply = { _ in .init(status: 200, body: Fixture.data("session")) }
            let grant: SessionGrant = try await api.post("api/v1/auth/code", body: ["code": "abc"])
            #expect(
                grant.user
                    == User(
                        id: "2f1c5b8e-0d7a-4c55-9a1e-6b3f2d9c8a71", email: "ada@example.test",
                        name: "Ada Lovelace"))
            #expect(abs(grant.expiresAt.timeIntervalSince1970 - 1_799_679_845.123) < 0.001)

            let request = try #require(StubURLProtocol.requests.first)
            #expect(request.httpMethod == "POST")
            #expect(request.url?.path() == "/api/v1/auth/code")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
            #expect(
                try JSONDecoder().decode([String: String].self, from: request.httpBody ?? Data()) == [
                    "code": "abc"
                ])
        }

        @Test func sendsTheStoredTokenAsBearer() async throws {
            tokens.setToken("tok")
            StubURLProtocol.reply = { _ in .init(status: 200, body: Fixture.data("me")) }
            let me: Me = try await api.get("api/v1/me")
            #expect(me.flags == .init(season: true, ai: true, payments: false))
            #expect(me.minAppVersion == "1.0")
            #expect(
                StubURLProtocol.requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
        }

        @Test func aRejectedTokenSignsOut() async {
            tokens.setToken("old")
            var signedOut = false
            api.onSignedOut = { signedOut = true }
            StubURLProtocol.reply = { _ in
                .init(status: 401, body: Data(#"{"error":"Sign in required"}"#.utf8))
            }
            await #expect(throws: APIError.signedOut) { let _: Me = try await api.get("api/v1/me") }
            #expect(tokens.token() == nil)
            #expect(signedOut)
        }

        @Test func aFailedSignInIsAnErrorNotASignOut() async {
            var signedOut = false
            api.onSignedOut = { signedOut = true }
            StubURLProtocol.reply = { _ in .init(status: 401, body: Fixture.data("error-expired-code")) }
            await #expect(
                throws: APIError.server(status: 401, message: "That sign-in has expired. Try again.")
            ) {
                let _: SessionGrant = try await api.post("api/v1/auth/code", body: ["code": "x"])
            }
            #expect(!signedOut)
        }

        @Test func mapsErrorsToSentences() async {
            StubURLProtocol.reply = { _ in
                .init(
                    status: 429,
                    body: Data(#"{"error":"Too many attempts. Wait a minute and try again."}"#.utf8))
            }
            await #expect(
                throws: APIError.server(
                    status: 429, message: "Too many attempts. Wait a minute and try again.")
            ) { try await api.send("POST", "api/v1/auth/email/start", body: ["email": "a@b.co"]) }

            StubURLProtocol.reply = { _ in .init(status: 502, body: Data("<html>".utf8)) }
            await #expect(
                throws: APIError.server(
                    status: 502, message: "Draft Room hit a problem. Try again in a moment.")
            ) { try await api.send("POST", "api/v1/auth/signout") }

            StubURLProtocol.reply = nil
            await #expect(throws: APIError.offline) { try await api.send("POST", "api/v1/auth/signout") }

            StubURLProtocol.reply = { _ in .init(status: 200, body: Data("{}".utf8)) }
            await #expect(throws: APIError.unreadable) { let _: Me = try await api.get("api/v1/me") }
        }
    }

    @MainActor
    @Suite
    struct SessionTests {
        @Test func comparesVersionsNumerically() {
            #expect(Session.isOlder("1.0", than: "1.1"))
            #expect(Session.isOlder("1.2", than: "1.10"))
            #expect(!Session.isOlder("1.10", than: "1.2"))
            #expect(!Session.isOlder("1.0", than: "1"))
            #expect(!Session.isOlder("2.0", than: "1.9.9"))
        }

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = nil
        }

        @Test func startsSignedOutWithoutAToken() async {
            let session = Session(
                api: APIClient(
                    baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(),
                    tokens: MemoryTokenStore()))
            await session.start()
            #expect(session.phase == .signedOut)
        }

        @Test func asksForAnUpdateBelowTheMinimumVersion() async {
            StubURLProtocol.reply = { _ in
                .init(
                    status: 200,
                    body: Data(
                        #"{"user":{"id":"u","email":null,"name":null},"flags":{"season":false,"ai":false,"payments":false},"minAppVersion":"2.0"}"#
                            .utf8))
            }
            let session = Session(
                api: APIClient(
                    baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(),
                    tokens: MemoryTokenStore("tok")), appVersion: "1.0")
            await session.start()
            #expect(session.phase == .updateRequired)
        }
    }

}

struct MagicLinkTests {
    @Test func readsAuthJsCallbackLinks() throws {
        let url = try #require(
            URL(
                string:
                    "https://draftroom.online/api/auth/callback/resend?callbackUrl=https%3A%2F%2Fdraftroom.online%2Fapp%2Fsigned-in&token=abc123&email=ada%40example.test"
            ))
        #expect(MagicLink(url) == MagicLink(email: "ada@example.test", token: "abc123"))
    }

    @Test func readsTheDevelopmentScheme() throws {
        let url = try #require(URL(string: "draftroom://auth/email?email=ada%40example.test&token=abc"))
        #expect(MagicLink(url)?.token == "abc")
    }

    @Test func ignoresOtherLinks() throws {
        #expect(MagicLink(try #require(URL(string: "https://draftroom.online/season/abc"))) == nil)
        #expect(
            MagicLink(
                try #require(
                    URL(string: "https://draftroom.online/api/auth/callback/resend?email=a%40b.co"))) == nil)
    }
}

extension MagicLink {
    init(email: String, token: String) {
        self.init(
            URL(
                string:
                    "draftroom://auth/email?email=\(email.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!)&token=\(token)"
            )!)!
    }
}
