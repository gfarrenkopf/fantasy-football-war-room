#if DEBUG
import Foundation

/// A small live week for previews and the `-uiTestStub` API: two teams mid-game, one hole, two
/// other matchups. The real shapes are pinned by the fixtures in DraftRoomTests/Fixtures.
enum SeasonSample {
    static let kickoff = Date(timeIntervalSince1970: 1_790_010_000)

    static func game(_ state: String, opponent: String = "NYJ", detail: String = "") -> GameState {
        GameState(state: state, detail: detail, opponent: opponent, home: true, kickoff: kickoff, score: state == "pre" ? nil : .init(team: 17, opponent: 10))
    }

    static func player(_ id: Int, _ name: String, _ pos: String, slot: String, actual: Double?, points: Double, game: GameState?, injury: String = "ACTIVE") -> ViewPlayer {
        ViewPlayer(playerId: id, name: name, pos: pos, team: "DET", slot: slot, injuryStatus: injury, locked: game.map { $0.state != "pre" } ?? false, actual: actual, points: points, game: game)
    }

    static let mine: [ViewPlayer] = [
        player(1, "Jalen Hurts", "QB", slot: "QB", actual: 18.4, points: 21.2, game: game("in", detail: "8:12 - 3rd")),
        player(2, "Jahmyr Gibbs", "RB", slot: "RB", actual: 22.1, points: 16.3, game: game("in", detail: "8:12 - 3rd")),
        player(3, "Puka Nacua", "WR", slot: "WR", actual: 9.6, points: 15.1, game: game("post")),
        player(4, "Sam LaPorta", "TE", slot: "TE", actual: nil, points: 10.2, game: game("pre", opponent: "GB")),
        player(5, "Jake Elliott", "K", slot: "K", actual: nil, points: 8.0, game: game("pre", opponent: "DAL")),
        player(6, "Tank Bigsby", "RB", slot: "BN", actual: nil, points: 7.4, game: game("pre", opponent: "GB")),
        player(7, "Josh Downs", "WR", slot: "BN", actual: nil, points: 9.1, game: nil, injury: "OUT"),
        player(8, "Tucker Kraft", "TE", slot: "BN", actual: nil, points: 11.6, game: game("pre", opponent: "CHI")),
    ]

    static let theirs: [ViewPlayer] = [
        player(11, "Joe Burrow", "QB", slot: "QB", actual: 14.0, points: 19.8, game: game("in", detail: "2:40 - 2nd")),
        player(12, "Bijan Robinson", "RB", slot: "RB", actual: 24.5, points: 17.9, game: game("post")),
        player(13, "CeeDee Lamb", "WR", slot: "WR", actual: 6.3, points: 16.0, game: game("in", detail: "2:40 - 2nd")),
        player(14, "Trey McBride", "TE", slot: "TE", actual: nil, points: 11.4, game: game("pre", opponent: "SF")),
        player(15, "Brandon Aubrey", "K", slot: "K", actual: 7.0, points: 9.0, game: game("post")),
    ]

    static func pace(_ players: [ViewPlayer]) -> [String: PlayerPace] {
        Dictionary(uniqueKeysWithValues: players.map { p in
            let pace: Pace = p.actual == nil ? .pre : (p.actual! >= p.points ? .boom : p.actual! >= p.points * 0.7 ? .on : .behind)
            return (String(p.playerId), PlayerPace(pace: pace, progress: p.game?.state == "in" ? 0.6 : nil))
        })
    }

    static let view = SeasonView(
        name: "App Tester", season: 2026, currentWeek: 3, myTeamId: 1,
        teams: [
            ViewTeam(id: 1, name: "Sunday Scaries", abbrev: "SUN", roster: mine),
            ViewTeam(id: 2, name: "Gridiron Gang", abbrev: "GRD", roster: theirs),
            ViewTeam(id: 3, name: "Hail Marys", abbrev: "HAIL", roster: []),
            ViewTeam(id: 4, name: "Blitz Brigade", abbrev: "BLTZ", roster: []),
        ])

    static func side(_ teamId: Int, _ name: String, _ points: Double, left: Int) -> LiveSide {
        LiveSide(teamId: teamId, name: name, points: points, projected: 98.6, left: left)
    }

    static let live = SeasonResponse(
        league: .init(id: "lg-1", name: "App Tester"),
        fetchedAt: kickoff,
        stale: false,
        projectionsMissing: false,
        phase: .live,
        defaultTab: "gameday",
        view: view,
        result: nil,
        live: LiveMatchup(week: 3, status: "Live", live: true, started: true, decided: false, lead: 4.3, win: 61, me: side(1, "Sunday Scaries", 56.1, left: 4), them: side(2, "Gridiron Gang", 51.8, left: 3)),
        gameDay: GameDay(
            week: 3,
            headToHead: [
                .init(key: "QB", me: 1, them: 11), .init(key: "RB", me: 2, them: 12), .init(key: "WR", me: 3, them: 13),
                .init(key: "TE", me: 4, them: 14), .init(key: "FLEX", me: nil, them: nil), .init(key: "K", me: 5, them: 15),
            ],
            starters: [],
            pace: pace(mine + theirs),
            around: [.init(home: side(3, "Hail Marys", 71.2, left: 2), away: side(4, "Blitz Brigade", 64.0, left: 3), left: 5)],
            bench: .init(playerIds: [8, 6, 7], points: 0),
            holes: [Hole(key: "FLEX", kind: "hard", reason: "empty", playerId: nil)],
            espnCall: EspnCall(me: .init(projected: 98.6, actual: nil), them: .init(projected: 101.2, actual: nil), best: .init(playerId: 2, projected: 16.3, actual: 22.1), worst: nil, season: CallRecord(weeks: 2, meanMiss: 11.4, meanBias: -2.1)),
            showArchive: false),
        lineup: lineup,
        consent: WriteConsent(version: 2, lines: ["Draft Room changes your team on ESPN only when you confirm a change.", "You can stop it any time by disconnecting ESPN."], agreed: false))

    /// War Room fills the empty FLEX with Bigsby; the games already on lock their players in.
    static let lineup = SeasonLineup(
        seats: ["QB", "RB", "WR", "TE", "FLEX", "K"],
        onEspn: [1, 2, 3, 4, nil, 5],
        recommended: [1, 2, 3, 4, 6, 5],
        eligible: [
            "1": ["QB", "BN"], "2": ["RB", "FLEX", "BN"], "3": ["WR", "FLEX", "BN"], "4": ["TE", "FLEX", "BN"],
            "5": ["K", "BN"], "6": ["RB", "FLEX", "BN"], "7": ["WR", "FLEX", "BN"], "8": ["TE", "FLEX", "BN"],
        ],
        tags: ["7": .init(label: "OUT", kind: "out")],
        startSit: .init(level: "gain", headline: "Start these and gain", gain: 7.4, total: 87.4, currentTotal: 80.0, banked: 0),
        holes: [])

    static var liveJSON: String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return String(decoding: (try? encoder.encode(live)) ?? Data(), as: UTF8.self)
    }
}
#endif
