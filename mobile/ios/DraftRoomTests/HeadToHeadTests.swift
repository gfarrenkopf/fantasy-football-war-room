import Foundation
import SwiftUI
import Testing

@testable import DraftRoom

/// The head-to-head's rows (APE-422): the stats behind a player's points, and his game split the way
/// the web's phone layout splits it, where the game stands on a line of its own.
@MainActor
@Suite
struct HeadToHeadTests {
    private func game(_ state: String, detail: String = "", score: GameState.Score? = nil, kickoff: Date? = nil) -> GameState {
        GameState(state: state, detail: detail, opponent: "CIN", home: true, kickoff: kickoff, score: score)
    }

    @Test func decodesTheStatLine() throws {
        let json = #"{"playerId":1,"name":"Lamar Jackson","pos":"QB","team":"BAL","slot":"QB","injuryStatus":"ACTIVE","locked":true,"actual":21.4,"points":19.9,"statLine":"241 YDS, 2 TD","game":null}"#
        let player = try APIClient.decoder.decode(ViewPlayer.self, from: Data(json.utf8))
        #expect(player.statLine == "241 YDS, 2 TD")
        let none = json.replacingOccurrences(of: #""statLine":"241 YDS, 2 TD","#, with: "")
        #expect(try APIClient.decoder.decode(ViewPlayer.self, from: Data(none.utf8)).statLine == nil)
    }

    @Test func splitsTheGameForANarrowColumn() {
        let live = SeasonFormat.gameParts(game("in", detail: "8:12 - 3rd", score: .init(team: 17, opponent: 10)))
        #expect(live == ["vs CIN", "17–10", "8:12 - 3rd"])
        let final = SeasonFormat.gameParts(game("post", score: .init(team: 10, opponent: 17)))
        #expect(final == ["vs CIN", "L 10–17", "Final"])
        #expect(SeasonFormat.game(game("post", score: .init(team: 10, opponent: 17))) == "vs CIN · L 10–17 · Final")
        #expect(SeasonFormat.gameParts(game("pre")) == ["vs CIN"])
    }

    @Test func givesTheNarrowColumnOneShortFactALine() {
        let final = SeasonFormat.gameLines(game("post", score: .init(team: 17, opponent: 10)))
        #expect(final.opponent == "vs CIN" && final.when == "W 17–10")
        let live = SeasonFormat.gameLines(game("in", detail: "2:40 - 2nd", score: .init(team: 7, opponent: 3)))
        #expect(live.when == "2:40 - 2nd")
        #expect(SeasonFormat.gameLines(game("pre")).when.isEmpty)
    }

    @Test(arguments: [("FLEX", "flex"), ("SUPERFLEX", "flex"), ("QB", "qb"), ("DST", "dst")])
    func slotsTakeTheirHue(key: String, token: String) {
        let tokens: [String: Color] = ["flex": .flex, "qb": .qb, "dst": .dst]
        #expect(Color.slot(key) == tokens[token])
    }
}
