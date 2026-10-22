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

    @Test func splitsTheNarrowColumnAsTheWebDoes() {
        let final = SeasonFormat.gameLines(game("post", score: .init(team: 17, opponent: 10)))
        #expect(final.lead == "vs CIN · W 17–10" && final.when == "Final")
        let live = SeasonFormat.gameLines(game("in", detail: "2:40 - 2nd", score: .init(team: 7, opponent: 3)))
        #expect(live.lead == "vs CIN · 7–3" && live.when == "2:40 - 2nd")
        let pre = SeasonFormat.gameLines(game("pre", kickoff: SeasonSample.kickoff))
        #expect(pre.lead == "vs CIN" && pre.when == SeasonFormat.kickoff(SeasonSample.kickoff))
        let unscheduled = SeasonFormat.gameLines(game("pre"))
        #expect(unscheduled.lead == "vs CIN" && unscheduled.when.isEmpty)
    }

    @Test func decodesTheNews() throws {
        let json = #"{"playerId":1,"name":"Lamar Jackson","pos":"QB","team":"BAL","slot":"QB","injuryStatus":"ACTIVE","locked":false,"actual":null,"points":19.9,"game":null,"news":{"note":"Expected to play.","at":"2026-10-18T15:04:05.000Z"}}"#
        let player = try APIClient.decoder.decode(ViewPlayer.self, from: Data(json.utf8))
        #expect(player.news?.note == "Expected to play.")
        #expect(player.news?.at == Date(timeIntervalSince1970: 1_792_335_845))
        let undated = json.replacingOccurrences(of: #""at":"2026-10-18T15:04:05.000Z""#, with: #""at":null"#)
        #expect(try APIClient.decoder.decode(ViewPlayer.self, from: Data(undated.utf8)).news?.at == nil)
        let none = json.replacingOccurrences(of: #""news":{"note":"Expected to play.","at":"2026-10-18T15:04:05.000Z"}"#, with: #""news":null"#)
        #expect(try APIClient.decoder.decode(ViewPlayer.self, from: Data(none.utf8)).news == nil)
    }

    @Test func speaksOfTheNewsOnlyOnTheUsersSide() {
        let qb = HeadToHead.spoken(.init(key: "QB", me: 1, them: 11), view: SeasonSample.view, day: SeasonSample.live.gameDay)
        #expect(qb.contains("Jalen Hurts, 18.4 points of 21.2 projected, 8:12 - 3rd, ESPN news. Theirs"))
        let rb = HeadToHead.spoken(.init(key: "RB", me: 2, them: 12), view: SeasonSample.view, day: SeasonSample.live.gameDay)
        #expect(!rb.contains("ESPN news"))
        // The same note on the opponent's side goes unsaid, as the tag goes unshown.
        let swapped = HeadToHead.spoken(.init(key: "QB", me: 11, them: 1), view: SeasonSample.view, day: SeasonSample.live.gameDay)
        #expect(!swapped.contains("ESPN news"))
    }

    @Test(arguments: [("FLEX", "flex"), ("SUPERFLEX", "flex"), ("QB", "qb"), ("DST", "dst")])
    func slotsTakeTheirHue(key: String, token: String) {
        let tokens: [String: Color] = ["flex": .flex, "qb": .qb, "dst": .dst]
        #expect(Color.slot(key) == tokens[token])
    }

    /// A bye, as the web's `onBye()` reads one (APE-430).
    @Test func marksAByeOnlyWithoutAGame() throws {
        func player(_ fields: String) throws -> ViewPlayer {
            let json = #"{"playerId":1,"name":"Josh Allen","pos":"QB","slot":"QB","injuryStatus":"ACTIVE","locked":false,"actual":null,"#
            return try APIClient.decoder.decode(ViewPlayer.self, from: Data((json + fields + "}").utf8))
        }
        #expect(try player(#""team":"BUF","points":0,"projected":true,"game":null"#).isOnBye)
        // An older server without `projected`.
        #expect(try player(#""team":"BUF","points":0,"game":null"#).isOnBye)
        // ESPN didn't project him, his team plays, he's projected, or he has no team.
        #expect(try !player(#""team":"BUF","points":0,"projected":false,"game":null"#).isOnBye)
        #expect(try !player(#""team":"BUF","points":0,"projected":true,"game":{"state":"pre","detail":"","opponent":"MIA","home":true,"kickoff":null,"score":null}"#).isOnBye)
        #expect(try !player(#""team":"BUF","points":21.3,"projected":true,"game":null"#).isOnBye)
        #expect(try !player(#""team":null,"points":0,"projected":true,"game":null"#).isOnBye)
    }
}
