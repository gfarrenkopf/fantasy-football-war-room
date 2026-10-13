import Foundation
import Observation

/// Who's signed in, and what the app should show for it. Owns the sign-in exchanges and sign-out.
@MainActor
@Observable
final class Session {
    enum Phase: Equatable {
        /// Checking a stored token with the server.
        case starting
        case signedOut
        case signedIn(Me)
        /// This build is older than the server's `minAppVersion`.
        case updateRequired
        /// A token exists but the server couldn't be reached to check it.
        case unreachable(String)
    }

    private(set) var phase: Phase = .starting
    let api: APIClient
    private let appVersion: String

    init(api: APIClient, appVersion: String = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0") {
        self.api = api
        self.appVersion = appVersion
        api.onSignedOut = { [weak self] in self?.phase = .signedOut }
    }

    var me: Me? {
        if case let .signedIn(me) = phase { me } else { nil }
    }

    /// On launch: with a stored token, ask the server who it belongs to.
    func start() async {
        guard api.hasToken else {
            phase = .signedOut
            return
        }
        await refresh()
    }

    func refresh() async {
        do {
            let me: Me = try await api.get("api/v1/me")
            phase = Self.isOlder(appVersion, than: me.minAppVersion) ? .updateRequired : .signedIn(me)
        } catch .signedOut {
            phase = .signedOut
        } catch {
            phase = .unreachable(error.message)
        }
    }

    /// Finishes any sign-in: keep the token, then load the account.
    func signedIn(with grant: SessionGrant) async {
        api.store(grant)
        await refresh()
    }

    func signOut() async {
        // Best effort: the token is forgotten here whatever the server says.
        try? await api.send("POST", "api/v1/auth/signout")
        api.clearToken()
        phase = .signedOut
    }

    func deleteAccount() async throws(APIError) {
        try await api.send("DELETE", "api/v1/account", body: ["confirm": "DELETE"])
        api.clearToken()
        phase = .signedOut
    }

    /// Dotted version comparison: "1.2" is older than "1.10".
    static func isOlder(_ version: String, than minimum: String) -> Bool {
        let a = version.split(separator: ".").map { Int($0) ?? 0 }
        let b = minimum.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0 ..< max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0
            let y = i < b.count ? b[i] : 0
            if x != y { return x < y }
        }
        return false
    }
}
