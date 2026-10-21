import Testing

@testable import DraftRoom

/// The league's mark in the switcher pill (APE-416): its initials, and a color that holds across launches.
@Suite
struct LeagueMarkTests {
    private func league(_ name: String, id: String = "lg-1") -> League {
        League(id: id, name: name, espnLeagueId: "704343562", espnTeamId: 1, season: 2026)
    }

    @Test(arguments: [
        ("Tampa Bros", "TB"),
        ("Dynasty", "DY"),
        ("the sunday regulars league", "TS"),
        ("Hail Marys & Co.", "HM"),
        ("2026 Champs", "2C"),
        ("", "?"),
    ])
    func monogram(name: String, expected: String) {
        #expect(league(name).monogram == expected)
    }

    @Test func colorIsSteadyAndInRange() {
        let ids = ["lg-1", "lg-2", "0b6c1f0e-4a5d-4c1e-9d3e-7f1a2b3c4d5e", ""]
        for id in ids {
            let index = league("Any", id: id).markIndex(of: 6)
            #expect((0 ..< 6).contains(index))
            #expect(index == league("Other", id: id).markIndex(of: 6))
        }
        // djb2 over the id, unlike `hashValue`, gives the same answer on every launch.
        #expect(league("Any", id: "lg-1").markIndex(of: 6) == 4)
    }
}
