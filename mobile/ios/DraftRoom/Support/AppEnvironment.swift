import Foundation
import Observation

/// Where the app's server lives. The URL comes from the `API_BASE_URL` build setting through
/// Info.plist (`APIBaseURL`): `http://localhost:3000` in Debug, `https://draftroom.online` in Release.
@Observable
final class AppEnvironment {
    let apiBaseURL: URL

    init(apiBaseURL: URL) {
        self.apiBaseURL = apiBaseURL
    }

    static var current: AppEnvironment {
        AppEnvironment(apiBaseURL: baseURL(from: Bundle.main.infoDictionary ?? [:]))
    }

    /// Reads `APIBaseURL` from an Info.plist dictionary. A missing or malformed value is a build
    /// misconfiguration, so it fails loudly rather than pointing the app somewhere unexpected.
    static func baseURL(from info: [String: Any]) -> URL {
        guard
            let raw = info["APIBaseURL"] as? String,
            let url = URL(string: raw),
            let scheme = url.scheme, ["http", "https"].contains(scheme),
            url.host() != nil
        else {
            fatalError("APIBaseURL in Info.plist is missing or invalid; check the API_BASE_URL build setting.")
        }
        return url
    }
}
