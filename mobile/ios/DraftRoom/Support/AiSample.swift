import Foundation

/// In-season AI for previews and the `-uiTestStub` API (APE-391), on SeasonSample's week: an AI
/// lineup that starts Tank Bigsby at the empty FLEX and Tucker Kraft over Sam LaPorta at TE.
/// Trade ideas (APE-392): Josh Downs for CeeDee Lamb with Gridiron Gang, and no bolder swing.
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
     "espn":{"matches":false,"text":"Not on ESPN yet: Tucker Kraft at TE, Tank Bigsby at FLEX."},"stale":false}
    """#

    static let ideas = #"""
    {"createdAt":"2026-09-17T15:00:00.000Z",
     "ideas":[{"kind":"safe","label":"Win-win","partner":{"id":2,"name":"Gridiron Gang"},
               "gives":[{"id":7,"name":"Josh Downs"}],"gets":[{"id":13,"name":"CeeDee Lamb"}],
               "status":"ok","note":null,
               "grade":{"headline":"Better for you","level":"gain","perWeek":2.1,"theirs":0.6,"delta":29.4,"weeks":14,"slots":[{"key":"WR","change":2.1}],"dropLines":[],"drops":[]},
               "moved":null,
               "why":"Downs is out this week but healthy for the playoffs; Lamb fills your WR spot now, and Gridiron Gang needs depth more than a star.",
               "pitch":"Downs for Lamb? You get a WR2 back for the stretch run, I get through my bye weeks.",
               "canOffer":true}],
     "missing":["No bolder swing this week that a partner would plausibly take."]}
    """#

    /// POST ai/trade: a counter, asking for Aubrey too.
    static let writeup = #"""
    {"lean":"counter","leanLabel":"Counter","summary":"Lamb is the better player, but Gridiron Gang loses little. Ask for a kicker on top.",
     "reasons":["Lamb adds 2.1 points a week to your WR spot.","Downs comes back from injury in week 5."],
     "counter":{"give":[{"id":7,"name":"Josh Downs"}],"get":[{"id":13,"name":"CeeDee Lamb"},{"id":15,"name":"Brandon Aubrey"}],"note":"Ask for Aubrey as a throw-in.",
                "text":"Send Josh Downs; ask for CeeDee Lamb, Brandon Aubrey. Ask for Aubrey as a throw-in."},
     "createdAt":"2026-09-17T15:00:00.000Z"}
    """#

    /// GET ai: before the lineup is written, or after, and before the ideas are found, or after.
    static func json(written: Bool, found: Bool = false, locked: Bool = false) -> String {
        if locked {
            return #"{"access":{"state":"locked","note":"\#(lockedNote)"},"week":3,"lineup":null,"lineupAction":null,"lineupNote":null,"ideas":null,"canFindIdeas":false}"#
        }
        return #"{"access":\#(trial),"week":3,"lineup":\#(written ? lineup : "null"),"lineupAction":\#(written ? "null" : #""write""#),"lineupNote":null,"ideas":\#(found ? ideas : "null"),"canFindIdeas":\#(!found)}"#
    }
}
