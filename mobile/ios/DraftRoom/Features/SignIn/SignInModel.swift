import AuthenticationServices
import CryptoKit
import Foundation
import Observation

/// The three ways in (docs/ios.md §4), each ending in a session from the server.
@MainActor
@Observable
final class SignInModel {
    enum Step: Equatable {
        case choose
        /// The magic link is on its way to this address.
        case checkInbox(String)
    }

    var step: Step = .choose
    var email = ""
    var busy = false
    var errorMessage: String?

    private let session: Session
    /// The raw nonce of the Apple request in flight; the server checks Apple put its hash in the token.
    private var appleNonce: String?

    init(session: Session) {
        self.session = session
    }

    private var api: APIClient { session.api }

    // MARK: Apple

    func prepare(_ request: ASAuthorizationAppleIDRequest) {
        let nonce = Self.randomNonce()
        appleNonce = nonce
        request.requestedScopes = [.fullName, .email]
        request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func finishApple(_ result: Result<ASAuthorization, any Error>) async {
        switch result {
        case let .failure(error):
            // Closing Apple's sheet isn't an error worth showing.
            if (error as? ASAuthorizationError)?.code != .canceled { errorMessage = "Sign in with Apple didn't finish. Try again." }
        case let .success(authorization):
            guard
                let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = credential.identityToken,
                let identityToken = String(data: tokenData, encoding: .utf8),
                let nonce = appleNonce
            else {
                errorMessage = "Sign in with Apple didn't finish. Try again."
                return
            }
            struct Body: Encodable {
                let identityToken: String
                let nonce: String
                let fullName: Name?
                struct Name: Encodable { let givenName: String?; let familyName: String? }
            }
            let name = credential.fullName.map { Body.Name(givenName: $0.givenName, familyName: $0.familyName) }
            await exchange("api/v1/auth/apple", Body(identityToken: identityToken, nonce: nonce, fullName: name))
        }
    }

    // MARK: Google

    /// The page that starts Google sign-in, and how the hand-off comes back: a Universal Link on the
    /// real server, the app's own scheme on a development server (see /api/v1/auth/handoff).
    var googleStart: (url: URL, callback: ASWebAuthenticationSession.Callback) {
        let url = api.baseURL.appending(path: "api/v1/auth/google")
        if api.baseURL.scheme == "https", let host = api.baseURL.host() {
            return (url, .https(host: host, path: "/app/callback"))
        }
        return (url, .customScheme("draftroom"))
    }

    func finishGoogle(callbackURL: URL) async {
        guard let code = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value else {
            errorMessage = "Google sign-in didn't finish. Try again."
            return
        }
        await exchange("api/v1/auth/code", ["code": code])
    }

    func googleFailed(_ error: any Error) {
        if (error as? ASWebAuthenticationSessionError)?.code != .canceledLogin { errorMessage = "Google sign-in didn't finish. Try again." }
    }

    // MARK: Email

    var emailLooksValid: Bool {
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        return trimmed.wholeMatch(of: /[^\s@]+@[^\s@]+\.[^\s@]+/) != nil
    }

    func sendLink() async {
        let address = email.trimmingCharacters(in: .whitespaces).lowercased()
        busy = true
        defer { busy = false }
        do {
            try await api.send("POST", "api/v1/auth/email/start", body: ["email": address])
            errorMessage = nil
            step = .checkInbox(address)
        } catch {
            errorMessage = error.message
        }
    }

    /// A sign-in link opened in the app: a magic link (a Universal Link to Auth.js's callback, or the
    /// app's scheme in development) or a Google hand-off. Returns false for any other link.
    @discardableResult
    func handle(_ url: URL) async -> Bool {
        // A Google hand-off that arrived as a link rather than through the browser sheet.
        if url.path() == "/app/callback" || (url.scheme == "draftroom" && url.host() == "auth" && url.path() == "/callback") {
            await finishGoogle(callbackURL: url)
            return true
        }
        guard let link = MagicLink(url) else { return false }
        await exchange("api/v1/auth/email", ["email": link.email, "token": link.token])
        return true
    }

    // MARK: -

    private func exchange(_ path: String, _ body: some Encodable) async {
        busy = true
        defer { busy = false }
        do {
            let grant: SessionGrant = try await api.post(path, body: body)
            errorMessage = nil
            await session.signedIn(with: grant)
        } catch {
            errorMessage = error.message
        }
    }

    private static func randomNonce() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64EncodedString()
    }
}

/// The parts of a magic link the app needs: Auth.js's `/api/auth/callback/resend?token=&email=`,
/// or `draftroom://auth/email?token=&email=` for testing on a development server.
struct MagicLink: Equatable {
    let email: String
    let token: String

    init?(_ url: URL) {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let isWeb = parts.path == "/api/auth/callback/resend"
        let isScheme = parts.scheme == "draftroom" && parts.host == "auth" && parts.path == "/email"
        guard isWeb || isScheme else { return nil }
        let items = parts.queryItems ?? []
        guard
            let email = items.first(where: { $0.name == "email" })?.value, !email.isEmpty,
            let token = items.first(where: { $0.name == "token" })?.value, !token.isEmpty
        else { return nil }
        self.email = email
        self.token = token
    }
}
