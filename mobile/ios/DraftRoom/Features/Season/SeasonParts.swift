import SwiftUI

// Pieces the season's tabs share, after the web's parts.tsx: a panel, a player's name and game,
// and his points against his projection. Text only: every number comes from the season route.

/// A season panel: a titled card on the panel tone, the web's `.panel` with its head band.
struct SeasonCard<Content: View, Accessory: View>: View {
    let title: String
    var note: String? = nil
    var tint: Color? = nil
    @ViewBuilder var accessory: () -> Accessory
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                Text(title).typeStyle(TypeScale.title).foregroundStyle(.text)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: Spacing.md)
                accessory()
                if let note { Text(note).typeStyle(TypeScale.label).foregroundStyle(.muted) }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.lg)
            content()
        }
        .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(tint ?? Color.line))
    }
}

extension SeasonCard where Accessory == EmptyView {
    init(title: String, note: String? = nil, tint: Color? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, note: note, tint: tint, accessory: { EmptyView() }, content: content)
    }
}

/// Where the user stands (APE-432), the web's Freshness strip: the week, their record and seed, and
/// points for and against. A bar under the navigation bar on every season tab, out of the way while
/// the user scrolls down and back on the way up, like the tab bar; nothing until ESPN sends a standing.
struct StandingStrip: View {
    let store: SeasonStore
    let bar: StandingBar
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if !bar.hidden, let view = store.season?.view, let standing = view.team(view.myTeamId)?.standing {
            // One line: the week and record always whole, points for and against trailing off when
            // the phone is narrow. At accessibility text sizes the line wraps instead.
            line(view: view, standing: standing, wraps: typeSize.isAccessibilitySize)
            .typeStyle(TypeScale.label)
            .padding(.horizontal, Spacing.xl + Spacing.xs)
            .padding(.vertical, Spacing.sm)
            // The bar can lay the strip out at its ideal width, the whole line centered and running off
            // both edges (APE-435); the screen's width keeps it leading and trailing off.
            .containerRelativeFrame(.horizontal, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Week \(view.currentWeek). \(SeasonFormat.spokenRecord(standing, teams: view.teams.count)). \(SeasonFormat.points(standing.pointsFor)) points for, \(SeasonFormat.points(standing.pointsAgainst)) against.")
            .accessibilityIdentifier("standing")
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private func line(view: SeasonView, standing: Standing, wraps: Bool) -> some View {
        let record = SeasonFormat.record(standing, teams: view.teams.count)
        let points = "\(SeasonFormat.points(standing.pointsFor)) for, \(SeasonFormat.points(standing.pointsAgainst)) against"
        return HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            Text("Week \(view.currentWeek)").fixedSize()
            if wraps {
                Text("\(Text(record).fontWeight(.bold).foregroundStyle(.text)) · \(points)")
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Text(record).fontWeight(.bold).foregroundStyle(.text).fixedSize()
                    Text(" · \(points)").lineLimit(1).truncationMode(.tail)
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.muted)
        .monospacedDigit()
    }
}

/// Whether the standing strip is out of the way (APE-432). The open tab's scroll view reports to it
/// (`hidesStandingOnScroll()`): a scroll down past `travel` hides the strip, one back up past it or
/// a return to the top shows it again. Only the open tab: the others sit at their own offsets, and a
/// refresh in one still at its top would bring the strip back mid-scroll (APE-435).
///
/// The strip's own coming and going moves the content's inset, and the offset follows, sometimes a
/// report later, by about the strip's height: taller than `travel` at large text, so it read as the
/// user scrolling and flipped the strip back (APE-438). Reports while the strip settles are ignored,
/// and it only goes once the content is well clear of the top, so the shift can't land at the top.
@MainActor
@Observable
final class StandingBar {
    private(set) var hidden = false

    /// Where the scroll last turned around, and which way it's going since. Nil until the open tab
    /// first scrolls: another tab's offset means nothing here.
    @ObservationIgnored private var turn: CGFloat?
    @ObservationIgnored private var down = true
    /// Until when the strip is still coming or going.
    @ObservationIgnored private var settling: ContinuousClock.Instant?
    @ObservationIgnored private let now: () -> ContinuousClock.Instant

    /// How far a scroll goes one way before the strip follows it: past a nudge, under a flick.
    static let travel: CGFloat = 32
    /// How far down the content has to be before the strip goes: past the strip's height, wrapped at the largest text.
    static let clear: CGFloat = 160
    /// How long the strip's coming and going takes to settle the scroll view's inset and offset.
    static let settle: Duration = .milliseconds(450)

    init(now: @escaping () -> ContinuousClock.Instant = { .now }) {
        self.now = now
    }

    func scrolled(from old: ScrollSpot, to new: ScrollSpot) {
        // Back at the top: always shown, whatever the strip is doing.
        if new.y + new.inset <= Spacing.xl { return show(true) }
        if let settling, now() < settling {
            turn = new.y
            return
        }
        // The inset moving isn't the user scrolling.
        guard old.inset == new.inset else {
            turn = new.y
            return
        }
        // Past the end the scroll view bounces back, which reads as a scroll up.
        guard new.y <= new.end else { return }
        if turn == nil || (new.y > old.y) != down {
            down = new.y > old.y
            turn = old.y
        }
        guard let turn, abs(new.y - turn) > Self.travel else { return }
        if down && new.y + new.inset < Self.clear { return }
        show(!down)
    }

    /// Back on screen, for a tab or league just opened.
    func reset() {
        turn = nil
        show(true)
    }

    private func show(_ shown: Bool) {
        guard hidden == shown else { return }
        settling = now() + Self.settle
        withAnimation(Motion.respond) { hidden = !shown }
    }
}

/// A scroll view's offset, its top inset and the farthest it scrolls, for the standing strip.
struct ScrollSpot: Equatable {
    let y: CGFloat
    let inset: CGFloat
    let end: CGFloat
}

extension View {
    /// Hides the standing strip while this scroll view scrolls down, and shows it on the way back up.
    func hidesStandingOnScroll() -> some View {
        modifier(HidesStandingOnScroll())
    }

    /// A tab's scroll content at exactly the scroll view's width (APE-434). The tab can hand its
    /// content a hair over the screen's width (354.00000000000006), and a card of full-width text
    /// rounds that up a whole pixel; the content then outgrew the screen, and the tab panned sideways.
    /// Every vertical scroll view's content takes it, pages and sheets too (APE-441).
    func tabWidth() -> some View {
        containerRelativeFrame(.horizontal)
    }
}

private struct HidesStandingOnScroll: ViewModifier {
    @Environment(StandingBar.self) private var bar: StandingBar?

    func body(content: Content) -> some View {
        content.onScrollGeometryChange(for: ScrollSpot.self) { geometry in
            ScrollSpot(
                y: geometry.contentOffset.y,
                inset: geometry.contentInsets.top,
                end: geometry.contentSize.height + geometry.contentInsets.bottom - geometry.containerSize.height)
        } action: { old, new in
            bar?.scrolled(from: old, to: new)
        }
    }
}

enum SeasonFormat {
    /// "4–2, 4th of 12", the web's recordText(): a tie only when there is one, the seed when ESPN gives it.
    static func record(_ standing: Standing, teams: Int) -> String {
        let record = "\(standing.wins)–\(standing.losses)" + (standing.ties > 0 ? "–\(standing.ties)" : "")
        return standing.seed.map { "\(record), \(RecapWords.ordinal($0)) of \(teams)" } ?? record
    }

    /// The record as VoiceOver says it: "4 and 2, 4th of 12".
    static func spokenRecord(_ standing: Standing, teams: Int) -> String {
        let record = "\(standing.wins) and \(standing.losses)" + (standing.ties > 0 ? " and \(standing.ties)" : "")
        return standing.seed.map { "\(record), \(RecapWords.ordinal($0)) of \(teams)" } ?? record
    }

    /// Points as the web shows them: one decimal.
    static func points(_ value: Double) -> String { LiveFormat.points(value) }

    /// A signed gain: "+4.2", "−1.5" (a true minus, like the web's `signed()`).
    static func signed(_ value: Double) -> String { (value >= 0 ? "+" : "−") + points(abs(value)) }

    /// "J. Gibbs": the web's shortName(); a D/ST keeps its name.
    static func shortName(_ player: ViewPlayer) -> String {
        guard player.pos != "DST", let space = player.name.firstIndex(of: " "), space != player.name.startIndex else { return player.name }
        return "\(player.name.prefix(1)). \(player.name[player.name.index(after: space)...])"
    }

    /// ESPN's injury designations as its short tags (the web's INJURY_TAG).
    /// ESPN says he won't play this week: the web's isRuledOut().
    static func isRuledOut(_ status: String) -> Bool { ["OUT", "INJURY_RESERVE", "SUSPENSION"].contains(status) }

    static func injuryTag(_ status: String) -> String? {
        switch status {
        case "QUESTIONABLE": "Q"
        case "DOUBTFUL": "D"
        case "OUT": "OUT"
        case "INJURY_RESERVE": "IR"
        case "SUSPENSION": "SSPD"
        default: nil
        }
    }

    /// "QB", "QB and TE", "QB, RB and TE": the web's holeSlots().
    static func slots(_ keys: [String]) -> String {
        var names: [String] = []
        for key in keys.map(SlotLabel.of) where !names.contains(key) { names.append(key) }
        guard names.count > 1 else { return names.first ?? "" }
        return names.dropLast().joined(separator: ", ") + " and " + names.last!
    }

    /// His NFL game, as the web's GameStatus: "vs NYJ · Sun 1:00 PM", "@ NYJ · 17–10 · 8:12 - 2nd", "vs NYJ · W 17–10 · Final".
    static func game(_ game: GameState) -> String {
        gameParts(game).joined(separator: " · ")
    }

    /// The pieces of `game(_:)`, in order.
    static func gameParts(_ game: GameState) -> [String] {
        let opponent = game.opponent.isEmpty ? nil : "\(game.home ? "vs" : "@") \(game.opponent)"
        let score = game.score.map { "\($0.team)–\($0.opponent)" }
        switch game.state {
        case "in":
            return [opponent, score, game.detail.isEmpty ? "Live" : game.detail].compactMap(\.self)
        case "post":
            let result = game.score.map { s in "\(s.team > s.opponent ? "W" : s.team < s.opponent ? "L" : "T") \(score ?? "")" }
            return [opponent, result, "Final"].compactMap(\.self)
        default:
            return [opponent, game.kickoff.map(kickoff)].compactMap(\.self)
        }
    }

    /// His game in two short lines, for the head-to-head's narrow column, split as the web's phone
    /// layout splits it: the opponent and score ("@ NYJ · W 17–10"), then where the game stands (the
    /// clock, "Final", the kickoff) on a line of its own.
    static func gameLines(_ game: GameState) -> (lead: String?, when: String) {
        let parts = gameParts(game)
        // Before a kickoff time is known, the opponent is all there is.
        if game.state == "pre" && game.kickoff == nil { return (parts.first, "") }
        let lead = parts.dropLast().joined(separator: " · ")
        return (lead.isEmpty ? nil : lead, parts.last ?? "")
    }

    /// Just where the game stands, for a narrow column: the clock, "Final", or the kickoff.
    static func gameWhen(_ game: GameState) -> String {
        switch game.state {
        case "in": game.detail.isEmpty ? "Live" : game.detail
        case "post": "Final"
        default: game.kickoff.map(kickoff) ?? game.opponent
        }
    }

    static func kickoff(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }

    /// The lead in words, never a bare signed number (DESIGN.md): "Up 15.3", "Lost by 4.0", "Tied".
    static func lead(_ lead: Double, started: Bool, decided: Bool) -> String {
        LiveFormat.lead(lead, started: started, decided: decided)
    }

    /// "Updated 3 min ago".
    static func updated(_ date: Date, now: Date = .now) -> String {
        let minutes = Int(now.timeIntervalSince(date) / 60)
        if minutes < 1 { return "Updated just now" }
        if minutes < 60 { return "Updated \(minutes) min ago" }
        return "Updated \(date.formatted(.dateTime.weekday(.abbreviated).hour().minute()))"
    }
}

/// A player's name with his injury tag, over his position, team and game.
struct PlayerLine: View {
    let player: ViewPlayer
    var showPosition = true
    /// A narrow column (the head-to-head): the short name, the game in two lines, and the web's
    /// phone-layout type sizes.
    var compact = false
    var alignment: HorizontalAlignment = .leading
    /// Offer ESPN's outlook for him, when there is one: a "News" tag beside his name that opens it
    /// in the sheet an ancestor's `newsSheet()` hosts.
    var news = false

    @Environment(\.openNews) private var openNews

    var body: some View {
        VStack(alignment: alignment, spacing: 1) {
            HStack(spacing: Spacing.xs) {
                Text(compact ? SeasonFormat.shortName(player) : player.name)
                    .typeStyle(TypeScale.body, dense: compact).foregroundStyle(.text).lineLimit(1)
                if let tag = SeasonFormat.injuryTag(player.injuryStatus) { InjuryChip(tag: tag, dense: compact) }
                if news, let openNews, player.news != nil {
                    // A row that is itself a button may be disabled (a locked seat); the note still opens.
                    NewsTag(name: player.name, dense: compact) { openNews(player) }
                        .environment(\.isEnabled, true)
                }
            }
            if compact, player.isOnBye {
                byeLine.typeStyle(TypeScale.label, dense: true).foregroundStyle(.muted).lineLimit(1)
            } else if compact, player.isFreeAgent {
                freeAgentLine.typeStyle(TypeScale.label, dense: true).foregroundStyle(.muted).lineLimit(1)
            } else if compact, let game = player.game {
                // A narrow column, as the web's phone head-to-head: the opponent and score on one line,
                // where the game stands on the next (in Terminal Sky behind a still dot while it's on),
                // then the stats behind his points.
                let lines = SeasonFormat.gameLines(game)
                let live = game.state == "in"
                if let lead = lines.lead {
                    HStack(spacing: Spacing.xs) {
                        if live { Circle().fill(.sky).frame(width: 6, height: 6).accessibilityHidden(true) }
                        Text(lead).lineLimit(1)
                    }
                    .typeStyle(TypeScale.label, dense: true).foregroundStyle(live ? Color.sky : Color.muted)
                }
                if !lines.when.isEmpty {
                    Text(lines.when).typeStyle(TypeScale.label, dense: true).foregroundStyle(live ? Color.sky : Color.muted).lineLimit(1)
                }
                if game.state != "pre", let stats = player.statLine, !stats.isEmpty {
                    Text(stats).typeStyle(TypeScale.label, dense: true).foregroundStyle(.muted).monospacedDigit()
                        .multilineTextAlignment(alignment == .trailing ? .trailing : .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else if player.isOnBye {
                byeLine.typeStyle(TypeScale.label).foregroundStyle(.muted).lineLimit(1)
            } else if player.isFreeAgent {
                freeAgentLine.typeStyle(TypeScale.label).foregroundStyle(.muted).lineLimit(1)
            } else {
                Text(detail).typeStyle(TypeScale.label).foregroundStyle(player.game?.state == "in" ? Color.sky : Color.muted).lineLimit(1)
            }
        }
    }

    /// His team and a BYE mark in warning ink, where his game would be (APE-430).
    private var byeLine: Text {
        let bye = Text("BYE").fontWeight(.bold).foregroundStyle(Color.warnInk)
        let lead = compact ? (player.team ?? "") : detail
        return lead.isEmpty ? bye : Text("\(lead) · \(bye)")
    }

    /// A FREE AGENT mark in warning ink where his game would be, after his position (APE-436).
    private var freeAgentLine: Text {
        let mark = Text("FREE AGENT").fontWeight(.bold).foregroundStyle(Color.warnInk)
        return compact || !showPosition ? mark : Text("\(SlotLabel.of(player.pos)) · \(mark)")
    }

    private var detail: String {
        guard let game = player.game else { return showPosition ? [SlotLabel.of(player.pos), player.team].compactMap(\.self).joined(separator: " · ") : (player.team ?? "") }
        let who = showPosition ? "\(SlotLabel.of(player.pos)) · " : ""
        return who + SeasonFormat.game(game)
    }
}

/// An injury designation as the web's tag: Q and D in warning ink, the rest (out, IR, suspended) in red,
/// each on a faint wash of its color.
struct InjuryChip: View {
    let tag: String
    var dense = false

    var body: some View {
        let warn = tag == "Q" || tag == "D"
        Text(tag)
            .typeStyle(TypeScale.micro, dense: dense)
            .foregroundStyle(warn ? Color.warnInk : Color.reachInk)
            .padding(.horizontal, dense ? 4 : 5)
            .background((warn ? Color.warn : Color.reach).opacity(0.16), in: RoundedRectangle(cornerRadius: Radius.sm))
            .fixedSize()
    }
}

/// ESPN's outlook for a player this week (APE-213, APE-423), as the web's NewsNote tag: a quiet
/// Terminal Sky "News", outlined and never filled, that opens the note.
struct NewsTag: View {
    let name: String
    var dense = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            // Dense, the name keeps the room, as on the web's phone: the tag drops its word.
            HStack(spacing: 3) {
                Image(systemName: "note.text").imageScale(dense ? .medium : .small)
                if !dense { Text("News") }
            }
            .typeStyle(TypeScale.micro, dense: dense)
            .foregroundStyle(.sky)
            .padding(.horizontal, dense ? 0 : 6)
            .frame(minWidth: dense ? 26 : nil, minHeight: dense ? 22 : 20)
            .background(Color.sky.opacity(0.06), in: RoundedRectangle(cornerRadius: Radius.sm))
            .overlay(RoundedRectangle(cornerRadius: Radius.sm).stroke(.skyLine))
            .fixedSize()
            // A 44pt target around a small tag, without growing the row.
            .padding(.vertical, Spacing.xl).contentShape(Rectangle()).padding(.vertical, -Spacing.xl)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("ESPN's news on \(name)")
    }
}

/// Opens ESPN's news on a player. Equal by the host that made it, so the environment can compare it
/// where it couldn't a bare closure.
struct OpenNewsAction: Equatable {
    let host: UUID
    let open: (ViewPlayer) -> Void

    func callAsFunction(_ player: ViewPlayer) { open(player) }

    static func == (a: Self, b: Self) -> Bool { a.host == b.host }
}

extension EnvironmentValues {
    /// Opens ESPN's news on a player, set by `newsSheet()`; without it, no News tag shows.
    @Entry var openNews: OpenNewsAction? = nil
}

extension View {
    /// Hosts the sheet that every News tag below opens (APE-423).
    func newsSheet() -> some View {
        modifier(NewsHost())
    }

    /// Offers ESPN's news on him as a named VoiceOver action, for a row read as one sentence, where
    /// the News tag inside can't be reached.
    func newsAction(_ player: ViewPlayer?) -> some View {
        modifier(NewsAction(player: player))
    }
}

private struct NewsHost: ViewModifier {
    @State private var reading: ViewPlayer?
    @State private var id = UUID()

    func body(content: Content) -> some View {
        let reading = $reading
        return content
            .environment(\.openNews, OpenNewsAction(host: id) { reading.wrappedValue = $0 })
            .sheet(item: $reading) { NewsSheet(player: $0) }
    }
}

private struct NewsAction: ViewModifier {
    let player: ViewPlayer?
    @Environment(\.openNews) private var openNews

    func body(content: Content) -> some View {
        content.accessibilityActions {
            if let player, player.news != nil, let openNews {
                Button("ESPN's news on \(player.name)") { openNews(player) }
            }
        }
    }
}

/// The note behind a News tag, in a sheet: whose it is, when ESPN had it, and the outlook itself.
struct NewsSheet: View {
    let player: ViewPlayer
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    if let at = player.news?.at {
                        Text("ESPN · \(SeasonFormat.kickoff(at))").typeStyle(TypeScale.label).foregroundStyle(.muted)
                    }
                    Text(player.news?.note ?? "").typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Spacing.xl + Spacing.xs)
                .tabWidth()
            }
            .background(.bg)
            .navigationTitle(player.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// What a player has scored, large, over his projection, with a meter of how much of it he has and
/// a tick where the game clock says he should be (the web's ScoreCell). The user's players earn green
/// past their projection; their opponent's ahead of pace read in red, from the user's chair.
struct ScoreCell: View {
    let player: ViewPlayer
    let pace: PlayerPace?
    var theirs = false
    var alignment: HorizontalAlignment = .trailing
    /// A narrow column (the head-to-head): the web's phone-layout sizes, and past his projection reads
    /// "+4.6", the "over" left to the green.
    var brief = false

    var body: some View {
        let level = pace?.pace ?? .pre
        let started = level != .pre
        let actual = player.actual ?? 0
        VStack(alignment: alignment, spacing: 2) {
            Text(SeasonFormat.points(started ? actual : player.points))
                .typeStyle(TypeScale.title, dense: brief).monospacedDigit()
                .foregroundStyle(tone(level))
                .contentTransition(.numericText(value: started ? actual : player.points))
            Text(sub(level, actual: actual)).typeStyle(TypeScale.label, dense: brief).foregroundStyle(.dim).monospacedDigit().lineLimit(1)
            if started && player.points > 0 {
                PaceMeter(share: min(1, max(0, actual / player.points)), due: pace?.progress, tint: tone(level) == Color.text ? Color.muted : tone(level), fromTrailing: alignment == .trailing)
                    .frame(width: brief ? 40 : 44, height: 3)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(level, actual: actual))
    }

    private func tone(_ level: Pace) -> Color {
        switch level {
        case .boom: theirs ? .reachInk : .value
        case .ahead: theirs ? .reachInk : .valueInk
        default: .text
        }
    }

    private func sub(_ level: Pace, actual: Double) -> String {
        switch level {
        case .pre: "proj"
        case .boom where player.points > 0: SeasonFormat.signed(actual - player.points) + (brief ? "" : " over")
        default: "of \(SeasonFormat.points(player.points))"
        }
    }

    private func spoken(_ level: Pace, actual: Double) -> String {
        switch level {
        case .pre: "projected \(SeasonFormat.points(player.points))"
        case .behind: "\(SeasonFormat.points(actual)) points, behind his projection of \(SeasonFormat.points(player.points))"
        case .on: "\(SeasonFormat.points(actual)) points, on pace with his projection of \(SeasonFormat.points(player.points))"
        case .ahead: "\(SeasonFormat.points(actual)) points, ahead of his projection of \(SeasonFormat.points(player.points))"
        case .boom: "\(SeasonFormat.points(actual)) points, past his whole projection of \(SeasonFormat.points(player.points))"
        }
    }
}

/// How much of his projection a player has, and where the game clock says he should be.
struct PaceMeter: View {
    let share: Double
    let due: Double?
    let tint: Color
    var fromTrailing = false

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: fromTrailing ? .trailing : .leading) {
                Capsule().fill(.line)
                Capsule().fill(tint).frame(width: geo.size.width * share)
                if let due {
                    Rectangle().fill(.text).frame(width: 1.5, height: geo.size.height + 4)
                        .offset(x: (fromTrailing ? -1 : 1) * geo.size.width * due)
                }
            }
        }
        .accessibilityHidden(true)
    }
}
