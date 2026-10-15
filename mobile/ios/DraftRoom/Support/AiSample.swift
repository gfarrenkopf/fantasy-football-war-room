import Foundation

/// In-season AI for previews and the `-uiTestStub` API (APE-391), on SeasonSample's week: an AI
/// lineup that starts Tank Bigsby at the empty FLEX and Tucker Kraft over Sam LaPorta at TE.
/// `-uiTestAiLocked` serves a league past its free weeks.
enum AiSample {
    static let trial = #"{"state":"trial","trialWeek":2,"trialWeeks":5,"note":"Free trial · week 2 of 5"}"#
    static let lockedNote = "Your free weeks of AI are over. AI lineups, trade ideas and trade write-ups come with this league's season pass, on draftroom.online. The recommended lineup and trade verdicts stay free."

    static let lineup = #"""
    {"intro":"Two changes. Bigsby fills the empty FLEX, and Kraft's matchup with Chicago edges LaPorta's.",
     "createdAt":"2026-09-17T15:00:00.000Z","total":84.9,
     "departures":"Start Tucker Kraft over Sam LaPorta at TE: a close call the AI makes differently from the recommended lineup.",
     "calls":[{"slot":"TE","player":{"id":8,"name":"Tucker Kraft"},"reason":"Chicago gives up the most points to tight ends; within two points of LaPorta."},
              {"slot":"FLEX","player":{"id":6,"name":"Tank Bigsby"},"reason":"Nobody's at FLEX on ESPN. Bigsby has the most carries behind a banged-up starter."}],
     "starters":[{"key":"QB","playerId":1,"locked":true},{"key":"RB","playerId":2,"locked":true},{"key":"WR","playerId":3,"locked":true},
                 {"key":"TE","playerId":8,"locked":false},{"key":"FLEX","playerId":6,"locked":false},{"key":"K","playerId":5,"locked":false}],
     "espn":{"matches":false,"text":"Not on ESPN yet: Tucker Kraft at TE, Tank Bigsby at FLEX."}}
    """#

    /// GET ai: before the lineup is written, or after.
    static func json(written: Bool, locked: Bool = false) -> String {
        if locked {
            return #"{"access":{"state":"locked","note":"\#(lockedNote)"},"week":3,"lineup":null,"lineupAction":null,"lineupNote":null,"ideas":null,"canFindIdeas":false}"#
        }
        return #"{"access":\#(trial),"week":3,"lineup":\#(written ? lineup : "null"),"lineupAction":\#(written ? "null" : #""write""#),"lineupNote":null,"ideas":null,"canFindIdeas":true}"#
    }
}
