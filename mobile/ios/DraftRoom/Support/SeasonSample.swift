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
        ],
        irSlots: 1,
        matchup: Matchup(
            me: MatchupSide(teamId: 1, points: 56.1, projected: 98.6, winProbability: 0.61),
            them: MatchupSide(teamId: 2, points: 51.8, projected: 101.2, winProbability: 0.39)),
        warRoomMoves: [WarRoomMove(playerId: 2, slot: "RB", gain: 3.1)])

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

    /// War Room fills the empty FLEX with Bigsby; the games already on lock their players in. Downs
    /// is out, so he could go to IR.
    static let lineup = SeasonLineup(
        seats: ["QB", "RB", "WR", "TE", "FLEX", "K"],
        onEspn: [1, 2, 3, 4, nil, 5],
        recommended: [1, 2, 3, 4, 6, 5],
        eligible: [
            "1": ["QB", "BN"], "2": ["RB", "FLEX", "BN"], "3": ["WR", "FLEX", "BN"], "4": ["TE", "FLEX", "BN"],
            "5": ["K", "BN"], "6": ["RB", "FLEX", "BN"], "7": ["WR", "FLEX", "BN", "IR"], "8": ["TE", "FLEX", "BN"],
        ],
        tags: ["7": .init(label: "OUT", kind: "out")],
        startSit: .init(
            level: "gain", headline: "Worth a swap", gain: 7.4, total: 87.4, currentTotal: 80.0,
            swaps: [.init(key: "FLEX", into: 6, out: nil, gain: 7.4, tag: nil)], banked: 3.1),
        holes: [])

    // MARK: The week decided (APE-402)

    /// The same week once every game is final: a win, 79.0 to 59.9.
    static let finalScores: [Int: Double] = [1: 24.1, 2: 22.1, 3: 9.6, 4: 14.2, 5: 9.0, 6: 11.3, 7: 0, 8: 6.2, 11: 14.0, 12: 24.5, 13: 6.3, 14: 8.1, 15: 7.0]

    static func finished(_ players: [ViewPlayer]) -> [ViewPlayer] {
        players.map { p in
            ViewPlayer(playerId: p.playerId, name: p.name, pos: p.pos, team: p.team, slot: p.slot, injuryStatus: p.injuryStatus, locked: true,
                       actual: finalScores[p.playerId], points: p.points, game: p.game.map { _ in game("post") })
        }
    }

    static func starter(_ id: Int, slot: String) -> WeekRecap.Starter {
        let p = mine.first { $0.playerId == id }!
        return .init(slot: slot, playerId: id, name: p.name, pos: p.pos, team: p.team, points: finalScores[id] ?? 0, projected: p.points)
    }

    static let finalResult = WeekResult(
        recap: WeekRecap(
            week: 3, result: .win, me: 79.0, them: 59.9, margin: 19.1, opponent: "Gridiron Gang",
            starters: [starter(1, slot: "QB"), starter(2, slot: "RB"), starter(3, slot: "WR"), starter(4, slot: "TE"), starter(5, slot: "K")],
            star: .init(player: starter(2, slot: "RB"), beat: true)),
        swing: WeekSwing(
            projected: -3.3, final: 19.1,
            swings: [
                .init(playerId: 13, name: "CeeDee Lamb", pos: "WR", side: "them", points: 6.3, projected: 16.0, delta: 9.7, before: -3.3, after: 6.4),
                .init(playerId: 12, name: "Bijan Robinson", pos: "RB", side: "them", points: 24.5, projected: 17.9, delta: -6.6, before: 6.4, after: -0.2),
                .init(playerId: 2, name: "Jahmyr Gibbs", pos: "RB", side: "me", points: 22.1, projected: 16.3, delta: 5.8, before: -0.2, after: 5.6),
                .init(playerId: 11, name: "Joe Burrow", pos: "QB", side: "them", points: 14.0, projected: 19.8, delta: 5.8, before: 5.6, after: 11.4),
            ],
            rest: .init(delta: 7.7, before: 11.4, after: 19.1), mine: 8.2, theirs: -14.2, empty: [],
            hindsight: .init(total: 90.3, gain: 11.3, wouldHaveWon: false, best: .init(name: "Tank Bigsby", points: 11.3))))

    static let final: SeasonResponse = {
        let decided = SeasonView(
            name: view.name, season: view.season, currentWeek: 3, myTeamId: 1,
            teams: view.teams.map { ViewTeam(id: $0.id, name: $0.name, abbrev: $0.abbrev, roster: finished($0.roster)) },
            matchup: Matchup(me: MatchupSide(teamId: 1, points: 79.0, projected: 79.0, winProbability: nil), them: MatchupSide(teamId: 2, points: 59.9, projected: 59.9, winProbability: nil)),
            warRoomMoves: view.warRoomMoves)
        let players = finished(mine + theirs)
        return SeasonResponse(
            league: live.league, fetchedAt: kickoff, stale: false, projectionsMissing: false, phase: .results, defaultTab: "gameday",
            view: view, result: decided,
            live: LiveMatchup(week: 3, status: "Final", live: false, started: true, decided: true, lead: 19.1, win: nil,
                              me: LiveSide(teamId: 1, name: "Sunday Scaries", points: 79.0, projected: 79.0, left: 0),
                              them: LiveSide(teamId: 2, name: "Gridiron Gang", points: 59.9, projected: 59.9, left: 0)),
            gameDay: GameDay(
                week: 3, headToHead: live.gameDay.headToHead, starters: [],
                pace: Dictionary(uniqueKeysWithValues: players.map { (String($0.playerId), PlayerPace(pace: ($0.actual ?? 0) >= $0.points ? .boom : .behind, progress: nil)) }),
                around: [], bench: .init(playerIds: [6, 8, 7], points: 17.5), holes: [],
                espnCall: EspnCall(me: .init(projected: 70.8, actual: 79.0), them: .init(projected: 74.1, actual: 59.9), best: .init(playerId: 2, projected: 16.3, actual: 22.1), worst: .init(playerId: 3, projected: 15.1, actual: 9.6), season: CallRecord(weeks: 2, meanMiss: 11.4, meanBias: -2.1)),
                showArchive: true, result: finalResult),
            lineup: lineup, consent: live.consent)
    }()

    static func json(_ season: SeasonResponse) -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return String(decoding: (try? encoder.encode(season)) ?? Data(), as: UTF8.self)
    }

    static var liveJSON: String { json(live) }

    // MARK: The waiver wire (APE-388)

    static func wirePlayer(_ id: Int, _ name: String, _ pos: String, points: Double, ros: Double, status: String = "FREEAGENT", clears: Date? = nil) -> ViewPlayer {
        var p = player(id, name, pos, slot: "BN", actual: nil, points: points, game: game("pre", opponent: "MIA"))
        p.ros = ros
        p.weekly = ["3": points, "4": points]
        p.status = status
        p.waiverClears = clears
        return p
    }

    /// A full roster: Rico Dowdle to add over Downs, Jennings still on waivers, and a week-4 hole at K.
    static let wire = WaiversResponse(
        pickups: [
            Pickup(player: wirePlayer(21, "Rico Dowdle", "RB", points: 10.6, ros: 148.4), delta: 44.8, perWeek: 3.2, drop: 7),
            Pickup(player: wirePlayer(22, "Jauan Jennings", "WR", points: 9.8, ros: 137.2, status: "WAIVERS", clears: kickoff.addingTimeInterval(86_400)), delta: 30.8, perWeek: 2.2, drop: 7),
        ],
        ahead: [
            Ahead(hole: .init(week: 4, key: "K", playerId: 5, reason: "zero"), fills: [.init(player: wirePlayer(23, "Chris Boswell", "K", points: 8.4, ros: 117.6), drop: 7)]),
        ],
        considered: 40, fetchedAt: kickoff, note: "Waiver priority 4 of 12",
        claims: .init(allowed: true, reason: nil),
        drops: .init(needed: true, candidates: [7, 6, 8, 5, 4, 3, 2, 1]))

    static var wireJSON: String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return String(decoding: (try? encoder.encode(wire)) ?? Data(), as: UTF8.self)
    }
}
#endif
