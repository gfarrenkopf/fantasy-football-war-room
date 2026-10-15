import Foundation
import Testing

@testable import DraftRoom

/// The Game day Live Activity's data (21.5), as the server's live job pushes it
/// (livePayload() in src/lib/server/liveActivities.ts).
struct LiveActivityTests {
    /// An `update` push's `content-state`, keys in jsonb's order rather than the type's.
    static let contentState = Data(#"""
    {"me":{"left":4,"name":"Mine","teamId":1,"points":74.2,"projected":118},"win":71,"lead":12.6,"live":true,"them":{"left":3,"name":"Gridiron Gang","teamId":2,"points":61.6,"projected":101.3},"week":6,"status":"Live","decided":false,"started":true}
    """#.utf8)

    @Test func decodesTheContentStateThePushCarries() throws {
        let state = try JSONDecoder().decode(GameDayAttributes.ContentState.self, from: Self.contentState)
        #expect(state.me == LiveSide(teamId: 1, name: "Mine", points: 74.2, projected: 118, left: 4))
        #expect(state.them.name == "Gridiron Gang")
        #expect(state.win == 71)
        #expect(state.live && state.started && !state.decided)
        #expect(LiveFormat.lead(state.lead, started: state.started, decided: state.decided) == "Up 12.6")
    }

    @Test func decodesAStateWithoutWinOdds() throws {
        let final = String(decoding: Self.contentState, as: UTF8.self).replacingOccurrences(of: #""win":71"#, with: #""win":null"#)
        #expect(try JSONDecoder().decode(LiveMatchup.self, from: Data(final.utf8)).win == nil)
    }

    @Test func decodesPushToStartAttributesAndOpensGameDay() throws {
        let attributes = try JSONDecoder().decode(GameDayAttributes.self, from: Data(#"{"leagueId":"lg-1","league":"Sunday Regulars"}"#.utf8))
        #expect(attributes.league == "Sunday Regulars")
        #expect(SeasonLink(attributes.url) == SeasonLink(leagueId: "lg-1", tab: .gameDay))
    }

    @Test func wordsTheLeadLikeTheScoreboard() {
        #expect(LiveFormat.lead(0.01, started: false, decided: false) == "vs")
        #expect(LiveFormat.lead(0, started: true, decided: false) == "Tied")
        #expect(LiveFormat.lead(-8.3, started: true, decided: false) == "Down 8.3")
        #expect(LiveFormat.lead(14.5, started: true, decided: true) == "Won by 14.5")
    }

    @Test func hexesAPushToken() {
        #expect(LiveActivityController.hex(Data([0x00, 0xab, 0x10])) == "00ab10")
    }
}
