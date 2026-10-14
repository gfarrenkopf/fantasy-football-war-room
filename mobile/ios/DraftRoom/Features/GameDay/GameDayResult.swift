import SwiftUI

// Game day once the week is decided, and between weeks (APE-402), after the web's MatchupMoment.tsx,
// WeekSwing.tsx and GameDayPanel's TrackRecord and LastWeek. Every number comes from the season
// route; these views only word it.

// MARK: - The result

/// The week's result: a win on a green wash in the stage face, with the show to watch again; a loss
/// (or a tie) a quiet panel with no motion and one bright spot. How the week swung follows, then the
/// card to share. The first time a won week is seen on this phone, Win Night opens over it.
struct ResultMoment: View {
    let leagueId: String
    let view: SeasonView
    let result: WeekResult
    var moments = MomentStore()

    @State private var showing = false
    @State private var card: RecapCardImage?
    @ScaledMetric(relativeTo: .largeTitle) private var titleSize: CGFloat = 44
    @ScaledMetric(relativeTo: .largeTitle) private var scoreSize: CGFloat = 34

    private var recap: WeekRecap { result.recap }
    private var win: Bool { recap.result == .win }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Week \(recap.week) · Final")
                    .typeStyle(TypeScale.label).fontWeight(.semibold).textCase(.uppercase).tracking(1.2)
                    .foregroundStyle(win ? Color.sky : Color.muted)
                Text(ResultWords.title(recap.result))
                    .font(.system(size: win ? titleSize : titleSize * 0.75, weight: .black).width(.compressed))
                    .textCase(.uppercase)
                    .foregroundStyle(win ? Color.valueInk : Color.muted)
                    .lineLimit(1).minimumScaleFactor(0.7)
                HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                    Text(SeasonFormat.points(recap.me)).foregroundStyle(win ? Color.valueInk : Color.text)
                    Text("–").foregroundStyle(.dim)
                    Text(SeasonFormat.points(recap.them)).foregroundStyle(.muted)
                }
                .font(.system(size: scoreSize, weight: .bold).width(.compressed).monospacedDigit())
                Text(ResultWords.line(recap)).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.text)
                    .fixedSize(horizontal: false, vertical: true)
                if let star = recap.star {
                    starLine(star).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(ResultWords.spoken(recap))
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("result-moment")

            if let swing = result.swing { WeekSwingView(swing: swing, result: recap.result) }

            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.md) { actions }
                VStack(spacing: Spacing.md) { actions }
            }
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(win ? Color.value.opacity(0.1) : Color.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(win ? Color.value.opacity(0.6) : Color.line))
        .onAppear {
            if moments.claimWinNight(leagueId: leagueId, season: view.season, recap: recap) { showing = true }
        }
        .task(id: recap) { card = RecapCardImage(recap: recap, league: view.name) }
        .fullScreenCover(isPresented: $showing) {
            WinNight(recap: recap, league: view.name) { showing = false }
        }
    }

    @ViewBuilder
    private var actions: some View {
        if win {
            Button("Watch it again") { showing = true }
                .buttonStyle(StageButtonStyle())
                .accessibilityIdentifier("watch-again")
        }
        if let card {
            ShareLink(item: card, preview: SharePreview(card.title, image: Image(uiImage: card.image))) {
                Label(win ? "Share win card" : "Share recap card", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(ProviderButtonStyle())
            .accessibilityIdentifier("share-card")
        }
    }

    private func starLine(_ star: WeekRecap.Star) -> Text {
        let lead = Text(recap.result == .loss ? "Bright spot: " : "Star of the week: ")
        let name = Text(star.player.name).bold()
        let scored = Text(" scored ") + Text(SeasonFormat.points(star.player.points)).bold().monospacedDigit()
        guard star.beat else { return lead + name + scored + Text(".") }
        let gain = Text(SeasonFormat.signed(star.player.points - star.player.projected)).foregroundColor(.valueInk).monospacedDigit()
        return lead + name + scored + Text(", ") + gain + Text(" over ESPN's call.")
    }
}

/// The result in words, shared by the panel, Win Night, the card and VoiceOver.
enum ResultWords {
    static func title(_ outcome: WeekRecap.Outcome) -> String {
        switch outcome {
        case .win: "You won"
        case .loss: "Not this week"
        case .tie: "A dead heat"
        }
    }

    static func line(_ recap: WeekRecap) -> String {
        let margin = SeasonFormat.points(recap.margin)
        switch recap.result {
        case .win: return "Beat \(recap.opponent) by \(margin)."
        case .loss: return "\(recap.opponent) took it by \(margin). Every contender drops one; the season is longer than a Sunday."
        case .tie: return "Level with \(recap.opponent), to the tenth of a point."
        }
    }

    /// The result as one sentence for VoiceOver.
    static func spoken(_ recap: WeekRecap) -> String {
        let score = "\(SeasonFormat.points(recap.me)) to \(SeasonFormat.points(recap.them))"
        var parts: [String]
        switch recap.result {
        case .win: parts = ["Week \(recap.week) final: you won, \(score), beating \(recap.opponent) by \(SeasonFormat.points(recap.margin))."]
        case .loss: parts = ["Week \(recap.week) final: you lost, \(score). \(recap.opponent) won by \(SeasonFormat.points(recap.margin))."]
        case .tie: parts = ["Week \(recap.week) final: a tie with \(recap.opponent), \(score)."]
        }
        if let star = recap.star {
            let who = recap.result == .loss ? "Bright spot" : "Star of the week"
            let over = star.beat ? ", \(SeasonFormat.points(star.player.points - star.player.projected)) over ESPN's call" : ""
            parts.append("\(who): \(star.player.name), \(SeasonFormat.points(star.player.points)) points\(over).")
        }
        return parts.joined(separator: " ")
    }

    /// A margin as the user's lead: "Up 27.8", "Down 12.0", or "Even" (never a bare signed number).
    static func lead(_ n: Double) -> String {
        n > 0 ? "Up \(SeasonFormat.points(n))" : n < 0 ? "Down \(SeasonFormat.points(-n))" : "Even"
    }

    static func final(_ n: Double, _ outcome: WeekRecap.Outcome) -> String {
        switch outcome {
        case .win: "Won by \(SeasonFormat.points(n))"
        case .loss: "Lost by \(SeasonFormat.points(-n))"
        case .tie: "Tied"
        }
    }

    /// "Gibbs", "Gibbs and Allen", "Gibbs, Allen and London".
    static func list(_ names: [String]) -> String {
        guard names.count > 1 else { return names.first ?? "" }
        return names.dropLast().joined(separator: ", ") + " and " + names.last!
    }
}

// MARK: - Why the week went that way

/// The week's swing (the web's WeekSwing.tsx, APE-243): ESPN's projected lead before kickoff, then
/// each player who moved it as a bar from the lead before him to the lead after, then the final. The
/// bars share one scale with a hairline at zero, so the bar that crosses it is where the week turned.
/// On a phone each bar runs the full width under its name and numbers. On a win they draw in once.
struct WeekSwingView: View {
    let swing: WeekSwing
    let result: WeekRecap.Outcome

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn = false

    private struct Step: Identifiable {
        let id: String
        let label: String
        let sub: String
        let delta: Double
        let before: Double
        let after: Double
    }

    private var steps: [Step] {
        swing.swings.map { w in
            Step(id: "p\(w.playerId)", label: w.name,
                 sub: "\(w.side == "them" ? "Their" : "Your") \(SlotLabel.of(w.pos)) · \(SeasonFormat.points(w.points)), projected \(SeasonFormat.points(w.projected))",
                 delta: w.delta, before: w.before, after: w.after)
        } + (swing.rest.map { [Step(id: "rest", label: "Everyone else", sub: "Every other starter, both teams", delta: $0.delta, before: $0.before, after: $0.after)] } ?? [])
    }

    var body: some View {
        let steps = steps
        if !steps.isEmpty {
            let ends: [Double] = [0, swing.projected, swing.final] + steps.flatMap { [$0.before, $0.after] }
            let scale = SwingScale(lo: ends.min() ?? 0, hi: ends.max() ?? 1)
            VStack(alignment: .leading, spacing: Spacing.lg) {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(title).typeStyle(TypeScale.title).foregroundStyle(.text).accessibilityAddTraits(.isHeader)
                    Text("Your lead, kickoff to final").typeStyle(TypeScale.label).foregroundStyle(.muted)
                }
                Text(verdict).typeStyle(TypeScale.label).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                VStack(spacing: Spacing.lg) {
                    mark("Before kickoff", sub: "ESPN's projection", value: ResultWords.lead(swing.projected), at: swing.projected, scale: scale, filled: false)
                    ForEach(Array(steps.enumerated()), id: \.element.id) { i, step in
                        row(step, index: i, scale: scale)
                    }
                    mark("Final", sub: nil, value: ResultWords.final(swing.final, result), at: swing.final, scale: scale, filled: true)
                }
                if !swing.empty.isEmpty {
                    (Text(ResultWords.list(swing.empty)).bold() + Text(" started but \(swing.empty.count == 1 ? "was" : "were") projected 0 and scored 0."))
                        .typeStyle(TypeScale.label).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                }
                if let hindsight = swing.hindsight, let best = hindsight.best, hindsight.wouldHaveWon || hindsight.gain >= 5 {
                    hindsightLine(hindsight, best: best)
                        .typeStyle(TypeScale.label).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.top, Spacing.lg)
            .overlay(alignment: .top) { Rectangle().fill(.rowLine).frame(height: 1) }
            // A win draws its bars in (each row's animation); a loss stays still, like the rest of its card.
            .onAppear { drawn = true }
        }
    }

    private var title: String {
        switch result {
        case .win: "Why you won"
        case .loss: "Why you lost"
        case .tie: "Why it ended level"
        }
    }

    /// The whole story in one sentence (the web's verdict()).
    private var verdict: String {
        let p = swing.projected
        let call = p > 0 ? "ESPN projected you to win by \(SeasonFormat.points(p))." : p < 0 ? "ESPN projected you to lose by \(SeasonFormat.points(-p))." : "ESPN projected a dead heat."
        let end = switch result {
        case .win: "You won by \(SeasonFormat.points(swing.final))"
        case .loss: "You lost by \(SeasonFormat.points(-swing.final))"
        case .tie: "It ended level"
        }
        func side(_ n: Double) -> String { "\(SeasonFormat.points(abs(n))) \(n >= 0 ? "more" : "fewer")" }
        return "\(call) \(end): your starters scored \(side(swing.mine)) points than projected, and theirs scored \(side(swing.theirs))."
    }

    private func hindsightLine(_ h: WeekSwing.Hindsight, best: WeekSwing.Hindsight.Best) -> Text {
        let lead = h.wouldHaveWon
            ? Text("Your best possible lineup would have won, with ") + Text(SeasonFormat.points(h.total)).bold() + Text(".")
            : Text("Your best possible lineup would have scored ") + Text(SeasonFormat.points(h.gain)).bold() + Text(" more.")
        return lead + Text(" \(best.name) scored ") + Text(SeasonFormat.points(best.points)).bold() + Text(" on your bench.")
    }

    private func row(_ step: Step, index: Int, scale: SwingScale) -> some View {
        let up = step.delta >= 0
        let tint = up ? Color.value : Color.softRed
        let animate = result == .win && !reduceMotion
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(step.label).typeStyle(TypeScale.body).foregroundStyle(.text)
                    Text(step.sub).typeStyle(TypeScale.label).foregroundStyle(.muted).monospacedDigit()
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: Spacing.md)
                VStack(alignment: .trailing, spacing: 1) {
                    Text(SeasonFormat.signed(step.delta)).typeStyle(TypeScale.body).foregroundStyle(up ? Color.valueInk : Color.reachInk)
                    Text(ResultWords.lead(step.after)).typeStyle(TypeScale.label).foregroundStyle(.muted)
                }
                .monospacedDigit()
            }
            SwingTrack(scale: scale) { width in
                let from = scale.x(min(step.before, step.after), width)
                let span = scale.x(max(step.before, step.after), width) - from
                Capsule().fill(tint)
                    .frame(width: max(2, drawn ? span : 0), height: 6)
                    .offset(x: drawn ? from : scale.x(step.before, width))
                    .animation(animate ? .timingCurve(0.16, 1, 0.3, 1, duration: 0.52).delay(0.15 + Double(index) * 0.11) : nil, value: drawn)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(step.label), \(step.sub). \(up ? "Helped you by" : "Cost you") \(SeasonFormat.points(abs(step.delta))), leaving you \(ResultWords.lead(step.after).lowercased()).")
    }

    private func mark(_ label: String, sub: String?, value: String, at: Double, scale: SwingScale, filled: Bool) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).typeStyle(TypeScale.body).foregroundStyle(.muted)
                    if let sub { Text(sub).typeStyle(TypeScale.label).foregroundStyle(.dim) }
                }
                Spacer(minLength: Spacing.md)
                Text(value).typeStyle(TypeScale.body).foregroundStyle(filled && result == .win ? Color.valueInk : Color.text).monospacedDigit()
            }
            SwingTrack(scale: scale) { width in
                Circle()
                    .fill(filled ? (result == .win ? Color.value : Color.text) : Color.clear)
                    .overlay(Circle().stroke(filled ? Color.clear : Color.muted, lineWidth: 1.5))
                    .frame(width: 9, height: 9)
                    .offset(x: scale.x(at, width) - 4.5)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label)\(sub.map { ", \($0)" } ?? ""): \(value)")
    }
}

/// One shared scale for every bar in the swing, from its lowest lead to its highest.
private struct SwingScale {
    let lo: Double
    let hi: Double

    func x(_ value: Double, _ width: CGFloat) -> CGFloat {
        let span = hi - lo == 0 ? 1 : hi - lo
        return CGFloat((value - lo) / span) * width
    }
}

/// A bar's lane: a faint track with a hairline at zero, where the lead changes hands.
private struct SwingTrack<Mark: View>: View {
    let scale: SwingScale
    @ViewBuilder var mark: (CGFloat) -> Mark

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.line.opacity(0.5)).frame(height: 2)
                Rectangle().fill(Color.muted.opacity(0.6)).frame(width: 1, height: 14).offset(x: scale.x(0, geo.size.width))
                mark(geo.size.width)
            }
            .frame(height: 14)
        }
        .frame(height: 14)
        .accessibilityHidden(true)
    }
}

// MARK: - Between weeks

/// ESPN's season on the user's team (the web's TrackRecord, APE-306): how far its call runs from the
/// score, which way it leans, how often it called the team too high, and its surest and shakiest reads.
struct TrackRecordCard: View {
    let record: TrackRecord
    let view: SeasonView

    var body: some View {
        let weeks = "\(record.weeks) \(record.weeks == 1 ? "week" : "weeks")"
        SeasonCard(title: "ESPN on your team", note: weeks) {
            VStack(spacing: 0) {
                CallRow(who: "Misses by") {
                    Text(SeasonFormat.points(record.meanMiss)).bold() + Text(" a week")
                        + (abs(record.meanBias) >= 0.5
                            ? Text(" · ") + Text("calls you \(record.meanBias > 0 ? "low" : "high")").foregroundColor(record.meanBias > 0 ? .valueInk : .reachInk)
                            : Text(""))
                }
                CallRow(who: "Called high") { Text("\(record.overcalled)").bold() + Text(" of \(weeks)") }
                if let surest = view.player(record.surest.playerId) {
                    CallRow(who: "Surest read") { Text("\(surest.name) · off ") + Text(SeasonFormat.points(record.surest.meanMiss)).bold() + Text(" a week") }
                }
                if let shakiest = view.player(record.shakiest.playerId) {
                    CallRow(who: "Shakiest") { Text("\(shakiest.name) · off ") + Text(SeasonFormat.points(record.shakiest.meanMiss)).bold() + Text(" a week") }
                }
            }
        }
        .accessibilityIdentifier("track-record")
    }
}

/// Last week's result between weeks (the web's LastWeek): the final, the margin, and the star.
struct LastWeekCard: View {
    let recap: WeekRecap

    var body: some View {
        SeasonCard(title: "Week \(recap.week)", note: "Final") {
            VStack(alignment: .leading, spacing: 0) {
                (Text(word).bold().foregroundColor(tone) + Text(" \(SeasonFormat.points(recap.me))–\(SeasonFormat.points(recap.them))").monospacedDigit()
                    + Text(" vs \(recap.opponent)").foregroundColor(.muted))
                    .typeStyle(TypeScale.body).foregroundStyle(.text)
                    .padding(.horizontal, Spacing.xl).padding(.bottom, Spacing.lg)
                    .fixedSize(horizontal: false, vertical: true)
                if let star = recap.star {
                    CallRow(who: "Star") {
                        Text("\(star.player.name) ") + Text(SeasonFormat.points(star.player.points)).bold()
                            + (star.beat ? Text(" " + SeasonFormat.signed(star.player.points - star.player.projected)).foregroundColor(.valueInk) : Text(""))
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("last-week")
    }

    private var word: String {
        switch recap.result {
        case .win: "Won"
        case .loss: "Lost"
        case .tie: "Tied"
        }
    }

    private var tone: Color {
        switch recap.result {
        case .win: .valueInk
        case .loss: .reachInk
        case .tie: .muted
        }
    }
}

/// A labelled line in a season card (the web's callRow): the label in a narrow column, the words
/// beside it. At the accessibility text sizes the label sits above instead.
struct CallRow<Content: View>: View {
    let who: String
    @ViewBuilder var content: () -> Content
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(spacing: 0) {
            Divider().overlay(.rowLine)
            let layout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.xs))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: Spacing.md))
            layout {
                Text(who).foregroundStyle(.muted).lineLimit(1)
                    .frame(width: typeSize.isAccessibilitySize ? nil : 96, alignment: .leading)
                content().foregroundStyle(.text).monospacedDigit().fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .typeStyle(TypeScale.label)
            .padding(.horizontal, Spacing.xl).padding(.vertical, Spacing.lg)
        }
    }
}

// MARK: - Shared pieces

/// The stage face's one filled button: green, black type, for the win's own actions (DESIGN.md
/// Opening Night Exception, scoped to Win Night and its panel).
struct StageButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.headline, weight: .heavy).width(.condensed))
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(.mineInk)
            .multilineTextAlignment(.center)
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.lg)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(configuration.isPressed ? Color.valueInk : Color.mine, in: RoundedRectangle(cornerRadius: Radius.dialog))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

extension Color {
    /// A position's hue (the web's --color-qb …).
    static func position(_ pos: String) -> Color {
        switch pos {
        case "QB": .qb
        case "RB": .rb
        case "WR": .wr
        case "TE": .te
        case "K": .k
        case "DST": .dst
        default: .muted
        }
    }
}
