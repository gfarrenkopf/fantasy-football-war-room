import Foundation
import Testing

@testable import DraftRoom

/// The deep links a tapped push opens (21.4), from the payloads in src/lib/season/pushes.ts.
struct PushLinkTests {
    @Test func readsARuledOutStartersLeagueTabAndPlayer() {
        let userInfo: [AnyHashable: Any] = ["aps": ["alert": ["title": "Night QB is out"]], "leagueId": "lg-1", "tab": "lineup", "playerId": "4421"]
        #expect(SeasonLink(push: userInfo) == SeasonLink(leagueId: "lg-1", tab: .lineup, playerId: 4421))
    }

    @Test func readsALeagueWithoutAPlayer() {
        #expect(SeasonLink(push: ["leagueId": "lg-2", "tab": "lineup"]) == SeasonLink(leagueId: "lg-2", tab: .lineup))
        #expect(SeasonLink(push: ["leagueId": "lg-2", "tab": "gameday"]) == SeasonLink(leagueId: "lg-2", tab: .gameDay))
        #expect(SeasonLink(push: ["leagueId": "lg-2", "tab": "scores", "playerId": "x"]) == SeasonLink(leagueId: "lg-2"))
    }

    @Test func ignoresAPushThatOpensNoLeague() {
        #expect(SeasonLink(push: ["aps": ["alert": ["title": "Reconnect ESPN"]]]) == nil)
        #expect(SeasonLink(push: ["leagueId": ""]) == nil)
    }

    @Test func readsTheTestingSchemeWithATabAndPlayer() {
        #expect(SeasonLink(URL(string: "draftroom://season/lg-1?tab=lineup&player=7")!) == SeasonLink(leagueId: "lg-1", tab: .lineup, playerId: 7))
    }
}
