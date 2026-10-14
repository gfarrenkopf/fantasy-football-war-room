#if DEBUG
import Foundation

/// The recap archive for previews and the `-uiTestStub` API (APE-384): App Tester's first three
/// weeks, week 3 being SeasonSample's final. The real shapes are pinned by the recap fixtures in
/// DraftRoomTests/Fixtures.
enum RecapSample {
    static let league = SeasonResponse.LeagueRef(id: "lg-1", name: "App Tester")

    private struct Week {
        let week: Int
        let result: WeekRecap.Outcome
        let me: Double
        let them: Double
        let opponent: String
        let headline: String
        let story: String
    }

    private static let played: [Week] = [
        Week(week: 3, result: .win, me: 79.0, them: 59.9, opponent: "Gridiron Gang", headline: "A 19.1-point win over Gridiron Gang.",
             story: "A 19.1-point win over Gridiron Gang. Jahmyr Gibbs led the way with 22.1. That's 2–1, 2nd in the league."),
        Week(week: 2, result: .loss, me: 88.2, them: 91.0, opponent: "Hail Marys", headline: "Brutal. Hail Marys got you by 2.8.",
             story: "Brutal. Hail Marys got you by 2.8. Puka Nacua's 19.4 deserved better. That's 1–1, 3rd in the league."),
        Week(week: 1, result: .win, me: 102.4, them: 87.3, opponent: "Blitz Brigade", headline: "A 15.1-point win over Blitz Brigade.",
             story: "A 15.1-point win over Blitz Brigade. Jalen Hurts blew past ESPN's 21.2 with 31.6. Nobody in the league scored more. That's 1–0, and first in the league."),
    ]

    private static let date = Date(timeIntervalSince1970: 1_790_400_000)

    private static func mine(_ w: Week) -> RecapResult { RecapResult(result: w.result, me: w.me, them: w.them, opponent: w.opponent) }

    static let archive = RecapsResponse(
        league: league, seasons: [2026],
        weeks: played.map { w in
            RecapSummary(season: 2026, week: w.week, headline: w.headline, mine: mine(w), date: date.addingTimeInterval(Double(w.week - 3) * 7 * 86400), settled: w.week < 3)
        })

    static let empty = RecapsResponse(league: SeasonResponse.LeagueRef(id: "lg-2", name: "Sunday Regulars"), seasons: [], weeks: [])

    private static func player(_ id: Int, _ name: String, _ pos: String, team: Int, _ teamName: String, points: Double, projected: Double, slot: String) -> RecapPlayer {
        RecapPlayer(playerId: id, name: name, pos: pos, team: "DET", slot: slot, points: points, projected: projected, teamId: team, teamName: teamName,
                    gap: ((points - projected) * 10).rounded() / 10)
    }

    /// One week in full; nil for a week not kept.
    static func recap(week: Int) -> RecapResponse? {
        guard let w = played.first(where: { $0.week == week }) else { return nil }
        let wins = played.filter { $0.week <= week && $0.result == .win }.count
        let standings = [
            StandingRow(teamId: 3, rank: 1, wins: week, losses: 0, ties: 0, name: "Hail Marys", mine: false),
            StandingRow(teamId: 1, rank: 2, wins: wins, losses: week - wins, ties: 0, name: "Sunday Scaries", mine: true),
            StandingRow(teamId: 2, rank: 3, wins: 1, losses: week - 1, ties: 0, name: "Gridiron Gang", mine: false),
            StandingRow(teamId: 4, rank: 4, wins: 0, losses: week, ties: 0, name: "Blitz Brigade", mine: false),
        ]
        let gibbs = player(2, "Jahmyr Gibbs", "RB", team: 1, "Sunday Scaries", points: 22.1, projected: 16.3, slot: "RB")
        let recap = LeagueRecap(
            week: week, mine: .init(result: w.result, me: w.me, them: w.them, margin: abs(w.me - w.them), opponent: w.opponent),
            headline: w.headline, story: w.story, standings: standings,
            topScorers: [
                player(12, "Bijan Robinson", "RB", team: 2, "Gridiron Gang", points: 24.5, projected: 17.9, slot: "RB"),
                gibbs,
                player(1, "Jalen Hurts", "QB", team: 1, "Sunday Scaries", points: 18.4, projected: 21.2, slot: "QB"),
            ],
            gameChanger: GameChanger(player: player(31, "Ja'Marr Chase", "WR", team: 3, "Hail Marys", points: 29.8, projected: 17.1, slot: "WR"), margin: 6.2, opponent: "Blitz Brigade", score: .init(his: 97.4, theirs: 91.2)),
            benchwarmers: [player(6, "Tank Bigsby", "RB", team: 1, "Sunday Scaries", points: 11.3, projected: 7.4, slot: "BN")],
            falseStarters: [
                player(13, "CeeDee Lamb", "WR", team: 2, "Gridiron Gang", points: 6.3, projected: 16.0, slot: "WR"),
                player(3, "Puka Nacua", "WR", team: 1, "Sunday Scaries", points: 9.6, projected: 15.1, slot: "WR"),
            ])
        let card = week == 3 ? SeasonSample.finalResult.recap
            : WeekRecap(week: week, result: w.result, me: w.me, them: w.them, margin: abs(w.me - w.them), opponent: w.opponent,
                        starters: SeasonSample.finalResult.recap.starters, star: SeasonSample.finalResult.recap.star)
        let summary = archive.weeks.first { $0.week == week }!
        return RecapResponse(league: league, season: 2026, week: week, headline: w.headline, mine: mine(w), date: summary.date, settled: summary.settled,
                             recap: recap, swing: week == 3 ? SeasonSample.finalResult.swing : nil, card: card)
    }

    static func json(_ value: some Encodable) -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return String(decoding: (try? encoder.encode(value)) ?? Data(), as: UTF8.self)
    }
}
#endif
