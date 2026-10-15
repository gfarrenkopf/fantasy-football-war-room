import Foundation

/// A link to a league's season page, `https://draftroom.online/season/<leagueId>`, optionally with a
/// week's recap picked (`?recap=2026-4`). The site's apple-app-site-association sends `/season/*` to
/// the app (src/lib/server/appSiteAssociation.ts), so the season emails and a shared recap open here
/// for anyone who has the app and the league, and on the web for everyone else.
///
/// A tapped push notification (21.4) opens one too, naming the tab and, for a ruled-out starter, the
/// player whose slot to open.
struct SeasonLink: Equatable {
    let leagueId: String
    var recap: RecapKey?
    /// The tab to open; Game day when nil.
    var tab: SeasonTab?
    /// On the Lineup tab: the player whose slot to open.
    var playerId: Int?

    init(leagueId: String, recap: RecapKey? = nil, tab: SeasonTab? = nil, playerId: Int? = nil) {
        self.leagueId = leagueId
        self.recap = recap
        self.tab = tab
        self.playerId = playerId
    }

    /// Reads a season push's payload (src/lib/season/pushes.ts): `leagueId`, `tab` and an optional
    /// `playerId`, beside `aps`. Nil for a push that opens no league.
    init?(push userInfo: [AnyHashable: Any]) {
        guard let leagueId = userInfo["leagueId"] as? String, !leagueId.isEmpty else { return nil }
        self.leagueId = leagueId
        tab = (userInfo["tab"] as? String).flatMap(SeasonTab.init(rawValue:))
        playerId = (userInfo["playerId"] as? String).flatMap { Int($0) }
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
        let query = { (name: String) in parts.queryItems?.first { $0.name == name }?.value }
        recap = query("recap").flatMap(Self.key)
        // Not on the web's links: for opening a push's target from `simctl openurl` while testing.
        tab = query("tab").flatMap(SeasonTab.init(rawValue:))
        playerId = query("player").flatMap { Int($0) }
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
