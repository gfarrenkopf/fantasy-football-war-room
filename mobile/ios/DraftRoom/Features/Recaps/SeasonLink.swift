import Foundation

/// A link to a league's season page, `https://draftroom.online/season/<leagueId>`, optionally with a
/// week's recap picked (`?recap=2026-4`). The site's apple-app-site-association sends `/season/*` to
/// the app (src/lib/server/appSiteAssociation.ts), so the season emails and a shared recap open here
/// for anyone who has the app and the league, and on the web for everyone else.
struct SeasonLink: Equatable {
    let leagueId: String
    var recap: RecapKey?

    init(leagueId: String, recap: RecapKey? = nil) {
        self.leagueId = leagueId
        self.recap = recap
    }

    /// Reads a season link, or `draftroom://season/<leagueId>?recap=` for testing on a development
    /// server, where Universal Links don't work; nil for any other link.
    init?(_ url: URL) {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        var path = parts.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        switch parts.scheme {
        case "http", "https": break
        case "draftroom" where parts.host == "season": path.insert("season", at: 0)
        default: return nil
        }
        guard path.count == 2, path[0] == "season", !path[1].isEmpty else { return nil }
        leagueId = path[1]
        recap = parts.queryItems?.first { $0.name == "recap" }?.value.flatMap(Self.key)
    }

    /// "2026-4" as season 2026, week 4.
    private static func key(_ raw: String) -> RecapKey? {
        let bits = raw.split(separator: "-")
        guard bits.count == 2, let season = Int(bits[0]), let week = Int(bits[1]), season > 0, week > 0 else { return nil }
        return RecapKey(season: season, week: week)
    }

    func url(base: URL) -> URL {
        var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) ?? URLComponents()
        parts.path = "/season/\(leagueId)"
        parts.queryItems = recap.map { [URLQueryItem(name: "recap", value: "\($0.season)-\($0.week)")] }
        return parts.url ?? base
    }
}
