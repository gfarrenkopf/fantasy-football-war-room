import SwiftUI

// The rest of the Lineup tab around the editor (APE-403), after the web's LineupPanel, LockIn.tsx
// and HoleHero.tsx: the start/sit verdict, what War Room's moves banked, the holes, and ESPN's
// matchup. Every number and word of the verdict comes from the season route.

/// How loudly the verdict speaks, by the server's emphasis level (the web's `.gain[data-level]`):
/// quiet at rest, and committing completely, tinted and breathing, when a lot is on the bench.
struct HeroEmphasis: Equatable {
    /// The number's type, before the phone's scale.
    let numberSize: CGFloat
    /// The number takes the gain's tone from `gain` up; at rest it's a ✓.
    let toned: Bool
    /// How much of the tone washes the card, and its border.
    let wash: Double
    let stroke: Double
    /// Must: the border breathes, as the web's on-clock glow does.
    let breathes: Bool

    init(level: String) {
        switch level {
        case "trim": self = .init(numberSize: 24, toned: true, wash: 0, stroke: 0, breathes: false)
        case "gain": self = .init(numberSize: 30, toned: true, wash: 0, stroke: 0.35, breathes: false)
        case "swing": self = .init(numberSize: 36, toned: true, wash: 0.09, stroke: 0.55, breathes: false)
        case "must": self = .init(numberSize: 42, toned: true, wash: 0.14, stroke: 0.7, breathes: true)
        default: self = .init(numberSize: 24, toned: false, wash: 0, stroke: 0, breathes: false)
        }
    }

    private init(numberSize: CGFloat, toned: Bool, wash: Double, stroke: Double, breathes: Bool) {
        self.numberSize = numberSize
        self.toned = toned
        self.wash = wash
        self.stroke = stroke
        self.breathes = breathes
    }

    var number: TypeToken { TypeToken(size: numberSize, weight: .heavy, lineHeight: 1, tracking: -numberSize * 0.03) }
}

/// The hero's card: the web's `.gain` panel, washed and edged in a tone.
private struct HeroCard<Content: View>: View {
    var tone: Color = .value
    var wash: Double = 0
    var stroke: Double = 0
    var breathes = false
    @ViewBuilder var content: () -> Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breath = false

    var body: some View {
        let edge = stroke > 0 ? tone.opacity(breathes && breath ? stroke * 0.55 : stroke) : Color.line
        VStack(alignment: .leading, spacing: Spacing.lg, content: content)
            .padding(Spacing.xl + Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Radius.dialog).fill(Color.panel).overlay(RoundedRectangle(cornerRadius: Radius.dialog).fill(tone.opacity(wash))))
            .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(edge, lineWidth: breathes ? 1.5 : 1))
            .onAppear {
                guard breathes, !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) { breath = true }
            }
    }
}

/// The hero's number beside what it means; stacked at the accessibility text sizes so neither is squeezed.
private struct HeroLead<Number: View, Detail: View>: View {
    @ViewBuilder var number: () -> Number
    @ViewBuilder var detail: () -> Detail
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        if size.isAccessibilitySize {
            VStack(alignment: .leading, spacing: Spacing.md) { number(); detail() }
        } else {
            HStack(alignment: .center, spacing: Spacing.xl + Spacing.md) { number(); detail() }
        }
    }
}

// MARK: - Start/sit

/// War Room's verdict on ESPN's lineup (the web's Gain hero): the points a switch gains, a headline
/// that grows with them, and the swaps. "Use Draft Room's lineup" only stages them in the editor.
struct StartSitHero: View {
    let model: LineupModel
    let week: Int

    var body: some View {
        if let lineup = model.lineup {
            let sit = lineup.startSit
            let suggesting = model.isSuggesting
            let emphasis = HeroEmphasis(level: suggesting ? sit.level : "rest")
            HeroCard(wash: emphasis.wash, stroke: emphasis.stroke, breathes: emphasis.breathes) {
                HeroLead {
                    Group {
                        if emphasis.toned {
                            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                                Text(SeasonFormat.signed(sit.gain)).typeStyle(emphasis.number).monospacedDigit()
                                Text("pts").typeStyle(TypeScale.label).fontWeight(.semibold).foregroundStyle(.muted)
                            }
                            .foregroundStyle(sit.level == "trim" ? Color.valueInk.opacity(0.75) : Color.valueInk)
                        } else {
                            Image(systemName: "checkmark").font(.system(size: 26, weight: .heavy)).foregroundStyle(.mine)
                        }
                    }
                    .fixedSize()
                } detail: {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        if suggesting {
                            HStack(spacing: Spacing.sm) {
                                Text(SeasonFormat.points(sit.currentTotal)).foregroundStyle(.dim)
                                Image(systemName: "arrow.right").font(.system(size: 9, weight: .bold)).foregroundStyle(.dim)
                                Text(SeasonFormat.points(sit.total)).fontWeight(.bold).foregroundStyle(.text)
                            }
                            .typeStyle(TypeScale.body).monospacedDigit()
                            Text("projected · week \(week)").typeStyle(TypeScale.label).foregroundStyle(.muted)
                            if sit.banked >= 0.05 {
                                Text("\(SeasonFormat.signed(sit.banked)) already banked").typeStyle(TypeScale.label).monospacedDigit().foregroundStyle(.muted)
                            }
                        }
                        Text(sit.headline).typeStyle(TypeScale.title).foregroundStyle(.text)
                            .accessibilityAddTraits(.isHeader)
                    }
                }
                if suggesting {
                    SwapList(swaps: sit.swaps.map { HeroSwap($0, model: model) })
                    if !model.isRecommended {
                        Button("Use Draft Room's lineup") { model.startFromDraftRoom() }
                            .buttonStyle(ProviderButtonStyle(prominent: true))
                            .accessibilityHint("Stages Draft Room's lineup. Nothing changes on ESPN until you save.")
                            .accessibilityIdentifier("use-draftroom")
                    }
                } else {
                    Text("\(SeasonFormat.points(sit.total)) projected points in week \(week). Check back before kickoff: injury news can change it.")
                        .typeStyle(TypeScale.label).foregroundStyle(.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("start-sit-hero")
        }
    }
}

/// A suggested swap as the hero words it.
struct HeroSwap: Identifiable {
    let id: String
    let slot: String
    let into: ViewPlayer?
    let out: ViewPlayer?
    let gain: Double
    let tag: SeasonLineup.Tag?

    @MainActor init(_ swap: SeasonLineup.Swap, model: LineupModel) {
        id = "\(swap.key)-\(swap.into.map(String.init) ?? "empty")"
        slot = SlotLabel.of(swap.key)
        into = model.player(swap.into)
        out = model.player(swap.out)
        gain = swap.gain
        tag = swap.tag
    }

    /// "Start Emeka Egbuka over Drake London", "Leave FLEX empty".
    var text: String {
        let lead = into.map { "Start \($0.name)" } ?? "Leave \(slot) empty"
        return out.map { "\(lead) over \($0.name)" } ?? lead
    }
}

private struct SwapList: View {
    let swaps: [HeroSwap]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            ForEach(swaps) { swap in
                HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                    Circle().fill(Color.value).frame(width: 5, height: 5).alignmentGuide(.firstTextBaseline) { $0[.bottom] + 1 }
                    (Text(swap.text) + Text(swap.tag.map { "  \($0.label)" } ?? "").foregroundStyle(swap.tag?.kind == "out" ? Color.reachInk : Color.warnInk).fontWeight(.bold))
                        .typeStyle(TypeScale.body).foregroundStyle(.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: Spacing.md)
                    Text(SeasonFormat.signed(swap.gain)).typeStyle(TypeScale.body).monospacedDigit()
                        .foregroundStyle(swap.gain < 0 ? Color.reachInk : Color.valueInk)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(swap.text)\(swap.tag.map { ", \($0.label)" } ?? ""), \(SeasonFormat.signed(swap.gain)) projected")
            }
        }
    }
}

// MARK: - Banked

/// The rest of the week once ESPN has War Room's lineup (the web's Banked): what its moves earned,
/// and the moves that earned it. Still, with no count or sweep: the user sees this every visit.
struct BankedHero: View {
    let model: LineupModel
    let week: Int

    var body: some View {
        if let lineup = model.lineup {
            let banked = lineup.startSit.banked
            let none = banked < 0.05
            let moves = model.store.season?.view.warRoomMoves ?? []
            let emphasis = HeroEmphasis(level: none ? "rest" : HeroEmphasis.level(banked))
            HeroCard(tone: .value, wash: max(0.06, emphasis.wash), stroke: max(0.4, emphasis.stroke)) {
                HeroLead {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                        Text(none ? SeasonFormat.points(lineup.startSit.total) : SeasonFormat.signed(banked))
                            .typeStyle(emphasis.number).monospacedDigit().foregroundStyle(none ? Color.text : Color.valueInk)
                        Text("pts").typeStyle(TypeScale.label).fontWeight(.semibold).foregroundStyle(.muted)
                    }
                    .fixedSize()
                } detail: {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        HStack(spacing: Spacing.sm) {
                            if !none { Text(SeasonFormat.points(lineup.startSit.total)).fontWeight(.bold).foregroundStyle(.text) }
                            Text("\(none ? "projected" : "on ESPN") · week \(week)").foregroundStyle(.muted)
                        }
                        .typeStyle(TypeScale.label).monospacedDigit()
                        Label {
                            Text("Your lineup is set").typeStyle(TypeScale.title).foregroundStyle(.text)
                        } icon: {
                            Image(systemName: "checkmark.seal.fill").foregroundStyle(.value)
                        }
                        .accessibilityAddTraits(.isHeader)
                    }
                }
                if !none {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        ForEach(moves) { move in
                            HStack(alignment: .firstTextBaseline) {
                                Text("\(model.player(move.playerId)?.name ?? "Player \(move.playerId)") in at \(SlotLabel.of(move.slot))")
                                    .typeStyle(TypeScale.body).foregroundStyle(.text)
                                Spacer(minLength: Spacing.md)
                                Text(SeasonFormat.signed(move.gain)).typeStyle(TypeScale.body).monospacedDigit().foregroundStyle(.valueInk)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                Text((none ? "ESPN has Draft Room's lineup." : "Draft Room's moves banked these points.") + " Check back before kickoff: injury news can change it.")
                    .typeStyle(TypeScale.label).foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("banked-hero")
        }
    }
}

extension HeroEmphasis {
    /// The web's lineupEmphasis(), for a banked total the server sends only as a number.
    static func level(_ points: Double) -> String {
        switch abs(points) {
        case 10...: "must"
        case 5...: "swing"
        case 1...: "gain"
        case 0.05...: "trim"
        default: "rest"
        }
    }
}

// MARK: - Holes

/// A hole's words (the web's HoleHero `Why` and HoleNote), kept out of the views so tests read them.
enum HoleText {
    /// "Holes at QB and TE".
    static func headline(_ holes: [Hole]) -> String {
        "\(holes.count == 1 ? "Hole at" : "Holes at") \(SeasonFormat.slots(holes.map(\.key)))"
    }

    /// Why the slot can't be filled: "Josh Allen OUT · no one else on your team can play QB".
    static func why(_ hole: Hole, holder: ViewPlayer?) -> String {
        let slot = SlotLabel.of(hole.key)
        guard let holder else { return "Nobody on your team can play \(slot)." }
        let what = hole.reason == "bye" ? "is on a bye" : (SeasonFormat.injuryTag(holder.injuryStatus) ?? "OUT")
        return "\(holder.name) \(what) · no one else on your team can play \(slot)"
    }

    /// A soft hole, as a note: "Tyler Warren is doubtful, with no backup at TE."
    static func soft(_ hole: Hole, holder: ViewPlayer?) -> String {
        let slot = SlotLabel.of(hole.key)
        let why = hole.reason == "doubtful" ? "is doubtful" : "may sit: ESPN projects him for 0"
        return "\(holder?.name ?? "Your \(slot)") \(why), with no backup at \(slot)."
    }

    /// Inside a day of kickoff, the note suggests a pickup; before then it only says to check back.
    static func soon(_ hole: Hole, now: Date) -> Bool {
        guard let kickoff = hole.kickoff else { return false }
        return kickoff.timeIntervalSince(now) < 24 * 60 * 60
    }
}

/// A starting slot nobody on the roster can play this week (the web's HoleHero): a warning where the
/// ✓ was, and why, slot by slot, each with Fill it (APE-404), which finds the free agent to add and
/// start there. War Room's other swaps stay listed under it.
struct HoleHero: View {
    let model: LineupModel
    let holes: [Hole]
    let week: Int
    /// Opens the fill for a hole.
    let onFill: (Hole) -> Void

    var body: some View {
        let total = model.lineup?.startSit.total ?? 0
        HeroCard(tone: .warn, wash: 0.07, stroke: 0.5) {
            HeroLead {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(SeasonFormat.points(total)).typeStyle(HeroEmphasis(level: "gain").number).monospacedDigit().foregroundStyle(.text)
                    Text("pts").typeStyle(TypeScale.label).fontWeight(.semibold).foregroundStyle(.muted)
                }
                .fixedSize()
            } detail: {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("projected · week \(week)").typeStyle(TypeScale.label).foregroundStyle(.muted)
                    Text(holes.count == 1 ? "0 from \(SlotLabel.of(holes[0].key))" : "0 from each hole").typeStyle(TypeScale.label).foregroundStyle(.warnInk)
                    Label {
                        Text(HoleText.headline(holes)).typeStyle(TypeScale.title).foregroundStyle(.text)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.warn)
                    }
                    .accessibilityAddTraits(.isHeader)
                }
            }
            VStack(alignment: .leading, spacing: Spacing.md) {
                ForEach(holes, id: \.key) { hole in
                    let holder = model.player(hole.playerId)
                    HoleWhy(hole: hole, holder: holder)
                    Button {
                        onFill(hole)
                    } label: {
                        Label("Fill it", systemImage: "plus")
                    }
                    .buttonStyle(ProviderButtonStyle(prominent: hole.key == holes.first?.key))
                    .accessibilityLabel("Fill your \(SlotLabel.of(hole.key)) hole")
                    .accessibilityIdentifier("fill-hole-\(hole.key)")
                }
            }
            .padding(Spacing.lg + Spacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.bg.opacity(0.35), in: RoundedRectangle(cornerRadius: Radius.lg))
            if model.isSuggesting {
                SwapList(swaps: model.lineup!.startSit.swaps.map { HeroSwap($0, model: model) })
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("hole-hero")
    }
}

private struct HoleWhy: View {
    let hole: Hole
    let holder: ViewPlayer?

    var body: some View {
        Group {
            if let holder {
                let slot = SlotLabel.of(hole.key)
                let tag = hole.reason == "bye" ? nil : (SeasonFormat.injuryTag(holder.injuryStatus) ?? "OUT")
                (Text(holder.name).fontWeight(.bold).foregroundStyle(Color.text)
                    + Text(tag.map { "  \($0)" } ?? " is on a bye").fontWeight(.bold).foregroundStyle(tag == nil ? Color.muted : Color.reachInk)
                    + Text(" · no one else on your team can play \(slot)").foregroundStyle(Color.muted))
            } else {
                Text(HoleText.why(hole, holder: nil)).foregroundStyle(.muted)
            }
        }
        .typeStyle(TypeScale.body)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityLabel(HoleText.why(hole, holder: holder))
    }
}

/// Soft holes (the web's HoleNote): something to watch, never a takeover. Inside a day of kickoff it
/// points at the Waivers tab for a pickup.
struct HoleNotes: View {
    let model: LineupModel
    let onWaivers: () -> Void

    var body: some View {
        let holes = model.softHoles
        if !holes.isEmpty {
            TimelineView(.everyMinute) { context in
                VStack(spacing: Spacing.md) {
                    ForEach(holes, id: \.key) { hole in
                        let soon = HoleText.soon(hole, now: context.date)
                        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                            Image(systemName: "exclamationmark.triangle").foregroundStyle(.warn).font(.system(size: 12, weight: .semibold))
                            VStack(alignment: .leading, spacing: Spacing.sm) {
                                Text(HoleText.soft(hole, holder: model.player(hole.playerId)))
                                    .typeStyle(TypeScale.body).foregroundStyle(.text)
                                    .fixedSize(horizontal: false, vertical: true)
                                if soon {
                                    Button(action: onWaivers) {
                                        Label("Consider a pickup", systemImage: "arrow.right").labelStyle(TrailingIcon())
                                    }
                                    .typeStyle(TypeScale.body).foregroundStyle(.sky)
                                    .accessibilityHint("Opens Waivers")
                                    .accessibilityIdentifier("hole-pickup")
                                } else {
                                    Text("Check back closer to kickoff.").typeStyle(TypeScale.label).foregroundStyle(.muted)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(Spacing.lg + Spacing.sm)
                        .background(Color.warn.opacity(0.06), in: RoundedRectangle(cornerRadius: Radius.lg))
                        .overlay(RoundedRectangle(cornerRadius: Radius.lg).stroke(Color.warn.opacity(0.3)))
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            .accessibilityIdentifier("hole-notes")
        }
    }
}

private struct TrailingIcon: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: Spacing.sm) {
            configuration.title
            configuration.icon.font(.system(size: 11, weight: .bold))
        }
    }
}

// MARK: - Matchup

/// This week's fantasy matchup in ESPN's own numbers (the web's MatchupCard): points once games
/// start, and ESPN's projection for the lineups set on ESPN, which isn't War Room's until it's saved.
struct MatchupCard: View {
    let view: SeasonView

    var body: some View {
        if let matchup = view.matchup {
            let started = matchup.me.points > 0 || matchup.them.points > 0
            let opponent = view.team(matchup.them.teamId)?.name ?? "Your opponent"
            SeasonCard(title: "Week \(view.currentWeek) matchup", note: "ESPN's numbers") {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .center, spacing: Spacing.xl) {
                            Side(name: "You", side: matchup.me, started: started, mine: true)
                            Text("vs").typeStyle(TypeScale.label).foregroundStyle(.dim).accessibilityHidden(true)
                            Side(name: opponent, side: matchup.them, started: started, mine: false)
                        }
                        VStack(alignment: .leading, spacing: Spacing.lg) {
                            Side(name: "You", side: matchup.me, started: started, mine: true)
                            Side(name: opponent, side: matchup.them, started: started, mine: false)
                        }
                    }
                    Group {
                        if let win = matchup.me.winProbability {
                            Text("ESPN gives you a \(Int((win * 100).rounded()))% chance to win. ")
                                + Text("Projections are for the lineups set on ESPN now.")
                        } else {
                            Text("Projections are for the lineups set on ESPN now.")
                        }
                    }
                    .typeStyle(TypeScale.label).foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.xl)
            }
            .accessibilityIdentifier("matchup-card")
        }
    }

    private struct Side: View {
        let name: String
        let side: MatchupSide
        let started: Bool
        let mine: Bool

        var body: some View {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(name).typeStyle(TypeScale.label).foregroundStyle(mine ? Color.mine : Color.muted).lineLimit(1)
                Text(SeasonFormat.points(started ? side.points : side.projected))
                    .typeStyle(TypeScale.headline).monospacedDigit().foregroundStyle(.text)
                Text(started ? "proj \(SeasonFormat.points(side.projected))" : "projected")
                    .typeStyle(TypeScale.label).monospacedDigit().foregroundStyle(.dim)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(name), \(started ? "\(SeasonFormat.points(side.points)) points, projected \(SeasonFormat.points(side.projected))" : "projected \(SeasonFormat.points(side.projected))")")
        }
    }
}

// MARK: - Started by Draft Room

/// The mark on a starter War Room put in his seat this week (the web's MadeNote): a green bar at the
/// row's edge and what the move gained. It draws in when the Lock In moment has just made it.
struct MadeMark: View {
    let move: WarRoomMove

    var body: some View {
        Label {
            Text("Started by Draft Room · \(SeasonFormat.signed(move.gain)) proj").monospacedDigit()
        } icon: {
            Image(systemName: "sparkle")
        }
        .typeStyle(TypeScale.micro)
        .foregroundStyle(.valueInk)
        .accessibilityHidden(true)
    }
}

/// The bar at a made row's leading edge; it grows in when `fresh`, and simply appears with Reduce Motion.
struct MadeBar: View {
    let fresh: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn = false

    var body: some View {
        Rectangle().fill(Color.value)
            .frame(width: 3)
            .scaleEffect(y: drawn ? 1 : 0, anchor: .top)
            .onAppear {
                guard fresh, !reduceMotion else { drawn = true; return }
                withAnimation(Motion.settle.delay(0.3)) { drawn = true }
            }
    }
}
