import SwiftUI

/// Game day (APE-380): the user's matchup as a scoreboard over both lineups, slot by slot, then
/// ESPN's call, the rest of the league and the bench, in the web panel's order (GameDayPanel.tsx)
/// as one scrolling column. Once the week is decided its result leads, and between weeks ESPN's
/// season on the user's team and last week's final follow the preview (APE-402). It reads itself
/// again each minute while a game is on and the screen is in front of the user, and keeps the last
/// read for when the phone has no signal. Whenever no game is on, the league's recap archive
/// follows (APE-384), each week opening its recap.
struct GameDayView: View {
    let store: SeasonStore
    let recaps: RecapsStore
    /// Opens the Lineup tab, where a hole is filled.
    let onLineup: () -> Void
    /// Opens ESPN's sign-in again, when the league's ESPN login has lapsed.
    let onReconnect: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var onScreen = false

    var body: some View {
        Group {
            if let season = store.season {
                ScrollView {
                    VStack(spacing: Spacing.xl) {
                        if case let .problem(message, reconnect) = store.load {
                            ProblemNote(message: message, reconnect: reconnect, onReconnect: onReconnect) { Task { await store.refresh(force: true) } }
                        }
                        GameDayContent(season: season, offline: store.offline, onLineup: onLineup)
                        if season.gameDay.showArchive {
                            RecapArchiveView(store: recaps, hiding: season.gameDay.result == nil ? nil : RecapKey(season: season.gameDayView.season, week: season.gameDayView.currentWeek), firstWeek: season.gameDay.week)
                                .task(id: recaps.leagueId) { await recaps.start() }
                                .jumpSection("Recaps")
                        }
                    }
                    .padding(.horizontal, Spacing.xl + Spacing.xs)
                    .padding(.vertical, Spacing.xl)
                }
                .sectionJump()
                .refreshable {
                    async let season: Void = store.refresh(force: true)
                    async let archive: Void = recaps.refresh()
                    _ = await (season, archive)
                }
                .id(season.league.id)
            } else {
                switch store.load {
                case .loading, .ready:
                    GameDaySkeleton()
                case let .problem(message, reconnect):
                    ProblemNote(message: message, reconnect: reconnect, onReconnect: onReconnect) { Task { await store.refresh(force: true) } }
                        .padding(Spacing.xl * 2)
                case let .failed(message):
                    FailedView(message: message) { Task { await store.refresh() } }
                }
            }
        }
        .background(.bg)
        .navigationDestination(for: RecapKey.self) { key in RecapReaderView(store: recaps, key: key) }
        .accessibilityIdentifier("gameday")
        .onAppear { onScreen = true }
        .onDisappear { onScreen = false }
        // Only while a game is on, the screen is showing and the app is in front, like the web's useLivePolling.
        .task(id: onScreen && scenePhase == .active && store.isLive) {
            guard onScreen, scenePhase == .active, store.isLive else { return }
            await store.poll()
        }
    }
}

private struct GameDayContent: View {
    let season: SeasonResponse
    let offline: Bool
    let onLineup: () -> Void

    var body: some View {
        let view = season.gameDayView
        let day = season.gameDay
        VStack(spacing: Spacing.xl) {
            FreshnessNote(season: season, offline: offline)
            if !day.holes.isEmpty { HoleBanner(holes: day.holes, onLineup: onLineup) }
            if let result = day.result {
                // The week is decided (APE-402): the result leads, both lineups as they finished below it.
                ResultMoment(leagueId: season.league.id, view: view, result: result)
                    .jumpSection("Result")
                SeasonCard(title: "Head to head", note: "As set on ESPN") {
                    VStack(spacing: 0) {
                        HStack {
                            Text("You").foregroundStyle(.mine)
                            Spacer(minLength: Spacing.md)
                            // The opponent's team name, as the web's head-to-head names it.
                            Text(view.matchup.flatMap { view.team($0.them.teamId)?.name } ?? "Your opponent").foregroundStyle(.muted).lineLimit(1)
                        }
                        .typeStyle(TypeScale.label, dense: true).fontWeight(.bold)
                        .padding(.horizontal, Spacing.lg).padding(.bottom, Spacing.sm)
                        .accessibilityHidden(true)
                        HeadToHead(view: view, day: day)
                    }
                }
                .jumpSection("Head to head")
            } else if let live = season.live {
                Scoreboard(live: live) {
                    HeadToHead(view: view, day: day)
                }
                .jumpSection("Scoreboard")
                if !live.decided { FollowLive(league: season.league, live: live) }
            } else {
                ByeStarters(view: view, day: day)
                    .jumpSection("Starters")
            }
            if let call = day.espnCall { EspnCallCard(call: call, view: view, live: season.live).jumpSection("ESPN's call") }
            // Between weeks: ESPN's season on the user's team, and last week until the archive keeps it.
            if let record = day.trackRecord { TrackRecordCard(record: record, view: view).jumpSection("ESPN on your team") }
            if let lastWeek = day.lastWeek { LastWeekCard(recap: lastWeek).jumpSection("Week \(lastWeek.week)") }
            if !day.around.isEmpty { AroundTheLeague(view: view, around: day.around).jumpSection("Around the league") }
            BenchCard(view: view, day: day)
                .jumpSection("Your bench")
        }
    }
}

// MARK: - Follow live

/// "Follow live" (21.5): the matchup on the lock screen and in the Dynamic Island until the week is
/// decided. While the app is open, each new read updates it at once.
private struct FollowLive: View {
    let league: SeasonResponse.LeagueRef
    let live: LiveMatchup
    @Environment(Session.self) private var session

    var body: some View {
        let controller = session.live
        Group {
            if controller.isFollowing(league.id) {
                HStack(spacing: Spacing.md) {
                    Image(systemName: "dot.radiowaves.left.and.right").foregroundStyle(.sky).accessibilityHidden(true)
                    Text("On your lock screen").foregroundStyle(.muted)
                    Spacer()
                    Button("Stop") { Task { await controller.stop(leagueId: league.id) } }
                        .foregroundStyle(.muted)
                }
                .typeStyle(TypeScale.label)
            } else if controller.enabled {
                Button {
                    controller.follow(leagueId: league.id, league: league.name, live: live)
                } label: {
                    Label("Follow live on your lock screen", systemImage: "dot.radiowaves.left.and.right")
                        .typeStyle(TypeScale.label)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.sky)
            }
        }
        .accessibilityIdentifier("follow-live")
        .task(id: live) { await controller.update(leagueId: league.id, live: live) }
    }
}

// MARK: - Scoreboard

/// The matchup as the screen's hero: both scores large, the lead between them in words and tone,
/// each side's projection and starters still to play, and ESPN's win odds as a split bar. Scores
/// tick as they change, with a light tap; a lead changing hands gets a heavier one.
private struct Scoreboard<Rows: View>: View {
    let live: LiveMatchup
    @ViewBuilder var rows: () -> Rows
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The scores: 40pt (the web's 34px phone size, scaled), growing with Dynamic Type.
    @ScaledMetric(relativeTo: .largeTitle) private var scoreSize: CGFloat = 40

    private var leader: Int { live.started ? (live.lead > 0.05 ? 1 : live.lead < -0.05 ? -1 : 0) : 0 }
    private var tone: Color { !live.started || leader == 0 ? .muted : leader > 0 ? .value : .reachInk }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: Spacing.lg) {
                HStack(alignment: .firstTextBaseline) {
                    HStack(spacing: Spacing.sm) {
                        Text("Week \(live.week)").foregroundStyle(.muted)
                        if live.live { Circle().fill(.sky).frame(width: 6, height: 6).accessibilityHidden(true) }
                        Text(live.status).foregroundStyle(live.live ? Color.sky : Color.text)
                    }
                    .typeStyle(TypeScale.title)
                    Spacer()
                    Text("ESPN's numbers").typeStyle(TypeScale.label).foregroundStyle(.dim)
                }
                HStack(alignment: .center, spacing: Spacing.md) {
                    side(live.me, name: "You", mine: true)
                    Text(SeasonFormat.lead(live.lead, started: live.started, decided: live.decided))
                        .typeStyle(TypeScale.body).foregroundStyle(tone)
                        .multilineTextAlignment(.center)
                        .contentTransition(.numericText(value: live.lead))
                        .frame(minWidth: 64)
                    side(live.them, name: live.them.name, mine: false)
                }
                if let win = live.win, !live.decided { WinOdds(win: win) }
            }
            .padding(Spacing.xl)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spoken)
            .accessibilityIdentifier("scoreboard")
            rows()
        }
        .modifier(GlassPanel(tint: leader > 0 ? Color.value.opacity(0.35) : nil))
        .animation(reduceMotion ? nil : Motion.respond, value: live)
        .sensoryFeedback(.impact(weight: .light), trigger: live.me.points + live.them.points)
        .sensoryFeedback(.impact(weight: .heavy), trigger: leader)
    }

    private func side(_ team: LiveSide, name: String, mine: Bool) -> some View {
        let number = live.started ? team.points : team.projected
        return VStack(spacing: Spacing.xs) {
            Text(name).typeStyle(TypeScale.label).foregroundStyle(mine ? Color.mine : Color.muted).lineLimit(1)
            Text(SeasonFormat.points(number))
                .font(.system(size: scoreSize, weight: .bold).monospacedDigit())
                .minimumScaleFactor(0.6).lineLimit(1)
                .foregroundStyle(.text)
                .contentTransition(.numericText(value: number))
            Text(live.started ? "proj \(SeasonFormat.points(team.projected))\(live.decided ? "" : " · \(team.left == 0 ? "done" : "\(team.left) to play")")" : "projected")
                .typeStyle(TypeScale.label).foregroundStyle(.dim).monospacedDigit().lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }

    private var spoken: String {
        let you = SeasonFormat.points(live.me.points), them = SeasonFormat.points(live.them.points)
        var parts = ["Week \(live.week), \(live.status)"]
        if live.started {
            parts.append("You \(you), \(live.them.name) \(them), \(SeasonFormat.lead(live.lead, started: true, decided: live.decided))")
            if !live.decided { parts.append("\(live.me.left) of your players left to play") }
        } else {
            parts.append("Projected: you \(SeasonFormat.points(live.me.projected)), \(live.them.name) \(SeasonFormat.points(live.them.projected))")
        }
        if let win = live.win, !live.decided { parts.append("ESPN gives you a \(win)% chance to win") }
        return parts.joined(separator: ". ")
    }
}

/// ESPN's win probability as a 4pt split bar: green against a 35% red (DESIGN.md game day).
private struct WinOdds: View {
    let win: Int

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            GeometryReader { geo in
                HStack(spacing: 0) {
                    Rectangle().fill(.value).frame(width: geo.size.width * Double(win) / 100)
                    Rectangle().fill(Color.reach.opacity(0.35))
                }
                .clipShape(Capsule())
            }
            .frame(height: 4)
            (Text("ESPN: ") + Text("\(win)%").bold() + Text(" to win"))
                .typeStyle(TypeScale.label).foregroundStyle(.muted).monospacedDigit()
                .contentTransition(.numericText(value: Double(win)))
        }
    }
}

/// The scoreboard's panel: Liquid Glass over the panel tone.
private struct GlassPanel: ViewModifier {
    let tint: Color?

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: Radius.dialog)
        content
            .background(Color.panel.opacity(0.6), in: shape)
            .glassEffect(.regular, in: shape)
            .overlay(shape.stroke(tint ?? Color.line))
    }
}

// MARK: - Head to head

/// Both lineups at once (APE-343): the user's starters on the left, their opponent's mirrored on the
/// right, paired by slot down a narrow spine, the points toward it. Sized as the web's phone layout
/// (APE-423), with ESPN's outlook on the user's players.
struct HeadToHead: View {
    let view: SeasonView
    let day: GameDay
    /// The player whose ESPN news is open.
    @State private var reading: ViewPlayer?

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(day.headToHead.enumerated()), id: \.offset) { _, row in
                let mine = row.me.flatMap(view.player)
                Divider().overlay(.rowLine)
                HStack(spacing: 0) {
                    H2HSide(player: mine, pace: row.me.flatMap(day.pace(of:)), theirs: false) { reading = $0 }
                    // The spine takes the slot's hue, as on the web: a wash over the tier tone, the label in the hue.
                    let hue = Color.slot(row.key)
                    Text(SlotLabel.of(row.key))
                        .typeStyle(TypeScale.micro, dense: true).foregroundStyle(hue.mix(with: .text, by: 0.2))
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .frame(width: 32)
                        .frame(maxHeight: .infinity)
                        .background(hue.opacity(0.14))
                        .background(.tier)
                    H2HSide(player: row.them.flatMap(view.player), pace: row.them.flatMap(day.pace(of:)), theirs: true)
                }
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Self.spoken(row, view: view, day: day))
                // The row is one sentence, so its News tag can't be reached inside it; offer it here.
                .accessibilityActions {
                    if let mine, mine.news != nil {
                        Button("ESPN's news on \(mine.name)") { reading = mine }
                    }
                }
            }
        }
        .sheet(item: $reading) { NewsSheet(player: $0) }
    }
}

extension HeadToHead {
    /// One slot as a sentence: "QB. Yours: Jalen Hurts, 18.4 points, …, ESPN news. Theirs: Joe Burrow, …".
    static func spoken(_ row: GameDay.SlotPair, view: SeasonView, day: GameDay) -> String {
        func side(_ id: Int?) -> String {
            guard let id, let player = view.player(id) else { return "empty" }
            let pace = day.pace(of: id)
            let started = (pace?.pace ?? .pre) != .pre
            let points = started ? "\(SeasonFormat.points(player.actual ?? 0)) points of \(SeasonFormat.points(player.points)) projected" : "projected \(SeasonFormat.points(player.points))"
            let game = player.game.map { ", \(SeasonFormat.gameWhen($0))" } ?? ""
            let news = row.me == id && player.news != nil ? ", ESPN news" : ""
            return "\(player.name), \(points)\(game)\(news)"
        }
        return "\(SlotLabel.of(row.key)). Yours: \(side(row.me)). Theirs: \(side(row.them))."
    }
}

private struct H2HSide: View {
    let player: ViewPlayer?
    let pace: PlayerPace?
    let theirs: Bool
    /// Opens ESPN's news on the user's player; the opponent's side offers none, as on the web.
    var onNews: ((ViewPlayer) -> Void)? = nil

    var body: some View {
        HStack(spacing: Spacing.sm) {
            if let player {
                if theirs { ScoreCell(player: player, pace: pace, theirs: true, alignment: .leading, brief: true) }
                PlayerLine(player: player, showPosition: false, compact: true, alignment: theirs ? .trailing : .leading,
                           onNews: theirs ? nil : onNews.map { open in { open(player) } })
                    .frame(maxWidth: .infinity, alignment: theirs ? .trailing : .leading)
                if !theirs { ScoreCell(player: player, pace: pace, brief: true) }
            } else {
                Text("Empty").typeStyle(TypeScale.label, dense: true).foregroundStyle(.dim)
                    .frame(maxWidth: .infinity, alignment: theirs ? .trailing : .leading)
            }
        }
        // As the web's half-phone column: a little more room at the screen's edge than at the spine.
        .padding(.leading, theirs ? Spacing.md : Spacing.lg)
        .padding(.trailing, theirs ? Spacing.lg : Spacing.md)
        .padding(.vertical, Spacing.md)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Other panels

/// Without a matchup (a bye week): the user's starters as set on ESPN.
private struct ByeStarters: View {
    let view: SeasonView
    let day: GameDay

    var body: some View {
        SeasonCard(title: "Starters", note: "No matchup this week") {
            VStack(spacing: 0) {
                ForEach(Array(day.starters.enumerated()), id: \.offset) { _, seat in
                    Divider().overlay(.rowLine)
                    if let player = seat.playerId.flatMap(view.player) {
                        PlayerRow(player: player, pace: day.pace(of: player.playerId), slot: seat.key)
                    } else {
                        HStack {
                            SlotBadge(key: seat.key)
                            Text("Empty on ESPN").typeStyle(TypeScale.label).foregroundStyle(.dim)
                            Spacer()
                        }
                        .padding(.horizontal, Spacing.xl).padding(.vertical, Spacing.lg)
                    }
                }
            }
        }
    }
}

/// A slot nobody on the roster can play this week: the fix lives on Lineup.
private struct HoleBanner: View {
    let holes: [Hole]
    let onLineup: () -> Void

    var body: some View {
        Button(action: onLineup) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.warn)
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("\(holes.count == 1 ? "Hole at" : "Holes at") \(SeasonFormat.slots(holes.map(\.key)))")
                        .typeStyle(TypeScale.body).foregroundStyle(.text)
                    Text("Nobody on your team can play \(holes.count == 1 ? "it" : "them") this week.")
                        .typeStyle(TypeScale.label).foregroundStyle(.muted)
                }
                Spacer(minLength: Spacing.md)
                Text(holes.count == 1 ? "Fill it" : "Fill them").typeStyle(TypeScale.body).foregroundStyle(.sky)
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.sky)
            }
            .padding(Spacing.xl)
            .background(Color.warn.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.dialog))
            .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(Color.warn.opacity(0.35)))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens Lineup")
        .accessibilityIdentifier("hole-banner")
    }
}

/// ESPN's call (APE-229): what ESPN projected before kickoff for both sides, against what they've scored.
private struct EspnCallCard: View {
    let call: EspnCall
    let view: SeasonView
    let live: LiveMatchup?

    var body: some View {
        SeasonCard(title: "ESPN's call", note: "Before kickoff") {
            VStack(alignment: .leading, spacing: 0) {
                if let me = call.me { line("You", me, now: live?.me.points) }
                if let them = call.them { line(live?.them.name ?? "Your opponent", them, now: live?.them.points) }
                if call.best != nil || call.worst != nil {
                    row("Surprises") {
                        HStack(spacing: Spacing.sm) {
                            if let best = call.best { surprise(best) }
                            if let worst = call.worst { surprise(worst) }
                        }
                    }
                }
                if let season = call.season {
                    Text(seasonLine(season)).typeStyle(TypeScale.label).foregroundStyle(.muted)
                        .padding(.horizontal, Spacing.xl).padding(.vertical, Spacing.lg)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func line(_ who: String, _ call: ProjectionCall, now: Double?) -> some View {
        row(who) {
            // One run of text, so it wraps between words rather than between pieces.
            let had = Text("ESPN had ") + Text(SeasonFormat.points(call.projected)).bold()
            Group {
                if let actual = call.actual {
                    had + Text(" · scored ") + Text(SeasonFormat.points(actual)).bold() + Text(" ")
                        + Text("(\(SeasonFormat.signed(actual - call.projected)))").foregroundColor(actual >= call.projected ? .valueInk : .reachInk)
                } else if let now {
                    had + Text(" · ") + Text(SeasonFormat.points(now)).bold() + Text(" so far")
                } else {
                    had
                }
            }
            .monospacedDigit()
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func surprise(_ call: PlayerCall) -> some View {
        let gap = (call.actual ?? call.projected) - call.projected
        return HStack(spacing: Spacing.xs) {
            Text(view.player(call.playerId).map(SeasonFormat.shortName) ?? "")
            Text(SeasonFormat.signed(gap)).foregroundStyle(gap >= 0 ? Color.valueInk : Color.reachInk).monospacedDigit()
        }
    }

    private func row(_ who: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(spacing: 0) {
            Divider().overlay(.rowLine)
            HStack(alignment: .firstTextBaseline) {
                Text(who).foregroundStyle(.muted).lineLimit(1).frame(width: 96, alignment: .leading)
                content().foregroundStyle(.text)
                Spacer(minLength: 0)
            }
            .typeStyle(TypeScale.label)
            .padding(.horizontal, Spacing.xl).padding(.vertical, Spacing.lg)
        }
    }

    private func seasonLine(_ season: CallRecord) -> String {
        let lean = abs(season.meanBias) >= 0.5 ? ", \(season.meanBias > 0 ? "underrating" : "overrating") you by \(SeasonFormat.points(abs(season.meanBias))) on average" : ""
        return "Over \(season.weeks) \(season.weeks == 1 ? "week" : "weeks"), ESPN has missed your score by \(SeasonFormat.points(season.meanMiss)) a week\(lean)."
    }
}

/// The league's other matchups while games are on (APE-309): small cards that scroll sideways.
private struct AroundTheLeague: View {
    let view: SeasonView
    let around: [GameDay.Around]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Around the league").typeStyle(TypeScale.title).foregroundStyle(.text).accessibilityAddTraits(.isHeader)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.md) {
                    ForEach(around, id: \.home.teamId) { game in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            side(game.home, against: game.away)
                            side(game.away, against: game.home)
                            Text(game.left == 0 ? "Done" : "\(game.left) to play").typeStyle(TypeScale.label).foregroundStyle(.dim)
                        }
                        .padding(Spacing.lg)
                        .frame(width: 132, alignment: .leading)
                        .background(.panel, in: RoundedRectangle(cornerRadius: Radius.xl))
                        .overlay(RoundedRectangle(cornerRadius: Radius.xl).stroke(.line))
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(game.home.name) \(SeasonFormat.points(game.home.points)), \(game.away.name) \(SeasonFormat.points(game.away.points)), \(game.left == 0 ? "done" : "\(game.left) to play")")
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    private func side(_ team: LiveSide, against other: LiveSide) -> some View {
        let leads = team.points > other.points
        let abbrev = view.team(team.teamId).map { $0.abbrev.isEmpty ? $0.name : $0.abbrev } ?? team.name
        return HStack {
            Text(abbrev).lineLimit(1)
            Spacer(minLength: Spacing.sm)
            Text(SeasonFormat.points(team.points)).monospacedDigit().bold()
                .contentTransition(.numericText(value: team.points))
        }
        .typeStyle(TypeScale.body)
        .foregroundStyle(leads ? Color.text : Color.muted)
    }
}

private struct BenchCard: View {
    let view: SeasonView
    let day: GameDay

    var body: some View {
        let players = day.bench.playerIds.compactMap(view.player)
        SeasonCard(title: "Your bench", note: day.bench.points > 0 ? "\(SeasonFormat.points(day.bench.points)) points on the bench" : "\(players.count) players") {
            VStack(spacing: 0) {
                ForEach(players) { player in
                    Divider().overlay(.rowLine)
                    PlayerRow(player: player, pace: day.pace(of: player.playerId))
                }
            }
        }
    }
}

/// One player on game day: his line on the left, his points on the right over his projection and pace.
struct PlayerRow: View {
    let player: ViewPlayer
    let pace: PlayerPace?
    var slot: String? = nil

    var body: some View {
        HStack(spacing: Spacing.md) {
            if let slot { SlotBadge(key: slot) }
            PlayerLine(player: player).frame(maxWidth: .infinity, alignment: .leading)
            ScoreCell(player: player, pace: pace)
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.lg)
        .accessibilityElement(children: .combine)
    }
}

struct SlotBadge: View {
    let key: String

    var body: some View {
        // A chip hued by the slot, as the head-to-head spine is; opaque, so a row's wash can't thin the ink.
        let hue = Color.slot(key)
        Text(SlotLabel.of(key)).typeStyle(TypeScale.micro).foregroundStyle(hue.mix(with: .text, by: 0.2))
            .lineLimit(1).minimumScaleFactor(0.7)
            .frame(width: 38, height: 24)
            .background(hue.opacity(0.14), in: RoundedRectangle(cornerRadius: Radius.md))
            .background(.panel, in: RoundedRectangle(cornerRadius: Radius.md))
    }
}

// MARK: - States

/// When the season shown was read, when that's worth saying: offline, or ESPN didn't answer.
struct FreshnessNote: View {
    let season: SeasonResponse
    let offline: Bool

    var body: some View {
        if offline || season.stale || season.projectionsMissing {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                Label(text(now: context.date), systemImage: offline ? "wifi.slash" : "clock.arrow.circlepath")
                    .typeStyle(TypeScale.label).foregroundStyle(.warnInk)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityIdentifier("freshness")
        }
    }

    private func text(now: Date) -> String {
        if season.projectionsMissing && !offline && !season.stale { return "ESPN's projections didn't load, so players show 0. Pull to refresh in a minute." }
        let when = SeasonFormat.updated(season.fetchedAt, now: now)
        return offline ? "Offline · \(when)" : "ESPN didn't answer · \(when)"
    }
}

struct ProblemNote: View {
    let message: String
    let reconnect: Bool
    let onReconnect: () -> Void
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text(message).typeStyle(TypeScale.body).foregroundStyle(.text).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Spacing.md) {
                if reconnect {
                    Button("Reconnect ESPN", action: onReconnect).buttonStyle(ProviderButtonStyle(prominent: true))
                        .accessibilityIdentifier("reconnect-espn")
                }
                Button("Try again", action: retry).buttonStyle(ProviderButtonStyle())
            }
        }
        .padding(Spacing.xl)
        .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(Color.warn.opacity(0.35)))
    }
}

struct FailedView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: "wifi.slash").font(.system(size: 30, weight: .semibold)).foregroundStyle(.muted)
            Text(message).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted).multilineTextAlignment(.center)
            Button("Try again", action: retry).buttonStyle(ProviderButtonStyle(prominent: true)).frame(maxWidth: 240)
        }
        .padding(Spacing.xl * 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The shape of Game day while the first read is on its way: the scoreboard and a few rows, still.
private struct GameDaySkeleton: View {
    @State private var dim = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: Spacing.xl) {
            RoundedRectangle(cornerRadius: Radius.dialog).fill(.panel).frame(height: 150)
            ForEach(0 ..< 6, id: \.self) { _ in
                RoundedRectangle(cornerRadius: Radius.md).fill(.panel).frame(height: 44)
            }
            Spacer()
        }
        .padding(Spacing.xl + Spacing.xs)
        .opacity(dim ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
        }
        .accessibilityLabel("Loading game day")
    }
}
