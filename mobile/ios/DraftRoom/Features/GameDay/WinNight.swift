import SwiftUI

/// Which of Game day's moments have played on this phone (the web's lib/storage/moments.ts), kept in
/// UserDefaults by league and week like the Lock In moment. Losing it only means a moment plays again.
struct MomentStore {
    var defaults: UserDefaults = .standard

    static func winNightKey(leagueId: String, season: Int, week: Int) -> String { "moment:\(leagueId):\(season):\(week):win" }

    /// Whether Win Night should open for this result: only for a win, and only the first time the
    /// week is seen. It's marked as it starts, not as it ends, so leaving mid-show doesn't run it again.
    func claimWinNight(leagueId: String, season: Int, recap: WeekRecap) -> Bool {
        guard recap.result == .win else { return false }
        let key = Self.winNightKey(leagueId: leagueId, season: season, week: recap.week)
        guard !defaults.bool(forKey: key) else { return false }
        defaults.set(true, forKey: key)
        return true
    }
}

/// Win Night (APE-230), native: the first time the user opens Game day after winning a week, the room
/// goes dark and the stage comes back for them, lit green from the floor. The week rises; a giant W
/// slams down and the phone thumps; both scores race up together, the opponent's stops and dims and
/// the user's runs past it with a tap; the margin wipes in on the green slab; the starters are dealt
/// face up; the spotlights swing onto the star of the week, confetti falls and the phone celebrates.
/// It ends on the win card to share.
///
/// A tap mid-show jumps to the end. With Reduce Motion or VoiceOver on, it's the finished stage,
/// faded in, still.
struct WinNight: View {
    let recap: WeekRecap
    let league: String
    let onDone: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var beat = 0
    @State private var raceStart: Date?
    @State private var passed = false
    @State private var shown = false
    /// The win card, drawn as the show starts so it's ready by the last beat.
    @State private var card: RecapCardImage?
    @ScaledMetric(relativeTo: .largeTitle) private var letterSize: CGFloat = 220
    @ScaledMetric(relativeTo: .largeTitle) private var scoreSize: CGFloat = 46
    @ScaledMetric(relativeTo: .largeTitle) private var starSize: CGFloat = 40

    /// The beats, as on the web: 1 week, 2 the W, 3 the race, 4 the margin, 5 the lineup, 6 the star, 7 the actions.
    static let finalBeat = 7
    static let raceSeconds = 1.9
    static let dealSeconds = 0.095

    /// When each beat lands, in seconds from the lights going down; the lineup's length sets the rest.
    static func beats(starters: Int) -> [Double] {
        let race = 1.15
        let margin = race + raceSeconds + 0.15
        let lineup = margin + 0.45
        let star = lineup + Double(starters) * dealSeconds + 0.45
        return [0.25, 0.62, race, margin, lineup, star, star + 1.5]
    }

    /// The race's level at `t` (0–1): eased so the finish line arrives with weight.
    static func level(_ t: Double, top: Double) -> Double { top * (1 - pow(1 - min(1, max(0, t)), 2.2)) }

    /// When in the race (0–1) the user's score passes the opponent's final.
    static func passMoment(me: Double, them: Double) -> Double? {
        let top = max(me, them, 1)
        guard me > them else { return nil }
        return 1 - pow(1 - them / top, 1 / 2.2)
    }

    private var still: Bool { reduceMotion || voiceOver }
    private func at(_ n: Int) -> Bool { beat >= n }
    private var skipping: Bool { beat < Self.finalBeat }

    var body: some View {
        ZStack {
            StageBackground(win: true).ignoresSafeArea()
            Beams(converge: at(6)).ignoresSafeArea().allowsHitTesting(false)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: Spacing.xl * 1.5) {
                        headline
                        race
                        Slab(text: "Won by \(SeasonFormat.points(recap.margin))", tone: .mine, ink: .mineInk, size: 26)
                            .mask(alignment: .leading) {
                                Rectangle().scaleEffect(x: at(4) ? 1 : 0, anchor: .leading)
                            }
                            .animation(still ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 0.5), value: beat)
                            .accessibilityHidden(true)
                        lineup
                        if let star = recap.star { starCard(star).id("star") }
                        actions
                    }
                    .padding(.horizontal, Spacing.xl * 1.5)
                    .padding(.top, Spacing.xl * 3)
                    .padding(.bottom, Spacing.xl * 2)
                }
                .scrollIndicators(.hidden)
                // The stage fades out under the status bar instead of running into it.
                .mask {
                    VStack(spacing: 0) {
                        LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: Spacing.xl * 3)
                        Color.black
                    }
                    .ignoresSafeArea(edges: .bottom)
                }
                .onChange(of: beat) { _, now in
                    // When the star lands below the fold, the camera follows it down.
                    guard now == 6, !still else { return }
                    withAnimation(.smooth(duration: 0.8)) { proxy.scrollTo("star", anchor: .center) }
                }
            }
            if at(6) && !still { Confetti().ignoresSafeArea().allowsHitTesting(false) }
        }
        .overlay(alignment: .topTrailing) {
            Button(skipping ? "Skip" : "Close") { skipping ? skip() : onDone() }
                .typeStyle(TypeScale.title).foregroundStyle(.text)
                .padding(.horizontal, Spacing.xl).padding(.vertical, Spacing.md)
                .background(.white.opacity(0.08), in: Capsule())
                .padding(Spacing.xl)
                .accessibilityIdentifier("win-night-close")
        }
        .contentShape(Rectangle())
        .onTapGesture { if skipping { skip() } }
        .opacity(shown ? 1 : 0)
        .environment(\.colorScheme, .dark)
        .accessibilityAction(.escape, onDone)
        // The W lands with a thump, passing them with a tap, the star with a celebration. The system
        // haptics setting governs all three.
        .sensoryFeedback(.impact(weight: .heavy, intensity: 1), trigger: beat) { old, new in old < 2 && new == 2 && !still }
        .sensoryFeedback(.impact(weight: .medium), trigger: passed) { _, now in now && !still }
        .sensoryFeedback(.success, trigger: beat) { old, new in old < 6 && new >= 6 && !still }
        .task {
            card = RecapCardImage(recap: recap, league: league)
            await run()
        }
    }

    // MARK: Beats

    private var headline: some View {
        VStack(spacing: Spacing.md) {
            Text("Week \(recap.week) · \(league)".uppercased())
                .font(.system(.subheadline, weight: .heavy).width(.condensed)).tracking(3)
                .foregroundStyle(.sky).multilineTextAlignment(.center)
                .opacity(at(1) ? 1 : 0).offset(y: at(1) || still ? 0 : 14)
                .animation(still ? nil : Motion.settle, value: beat)
            Text("W")
                .font(.system(size: letterSize, weight: .black).width(.compressed))
                .foregroundStyle(.mine)
                .shadow(color: Color.mine.opacity(at(2) ? 0.55 : 0), radius: 40)
                .scaleEffect(at(2) || still ? 1 : 3.2)
                .rotationEffect(.degrees(at(2) || still ? 0 : 6))
                .blur(radius: at(2) || still ? 0 : 14)
                .opacity(at(2) ? 1 : 0)
                .animation(still ? nil : .spring(duration: 0.42, bounce: 0.32), value: beat)
                .keyframeAnimator(initialValue: 0.0, trigger: at(2) && !still) { view, x in
                    view.offset(x: x)
                } keyframes: { _ in
                    KeyframeTrack {
                        CubicKeyframe(0, duration: 0.3)
                        CubicKeyframe(-9, duration: 0.05)
                        CubicKeyframe(8, duration: 0.06)
                        CubicKeyframe(-5, duration: 0.06)
                        CubicKeyframe(3, duration: 0.06)
                        CubicKeyframe(0, duration: 0.08)
                    }
                }
                .frame(height: letterSize * 0.9)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("You won week \(recap.week), \(SeasonFormat.points(recap.me)) to \(SeasonFormat.points(recap.them)), by \(SeasonFormat.points(recap.margin)).")
        .accessibilityAddTraits(.isHeader)
    }

    private var race: some View {
        TimelineView(.animation(paused: !(at(3) && skipping) || still)) { context in
            let (me, them) = scores(at: context.date)
            HStack(alignment: .top, spacing: Spacing.lg) {
                side("You", me, mine: true, done: false)
                Text("vs").typeStyle(TypeScale.label).foregroundStyle(.dim).padding(.top, scoreSize * 0.55)
                side(recap.opponent, them, mine: false, done: them >= recap.them && at(3))
            }
        }
        .opacity(at(3) ? 1 : 0)
        .animation(still ? nil : Motion.fade, value: at(3))
        .accessibilityHidden(true)
    }

    private func side(_ name: String, _ score: Double, mine: Bool, done: Bool) -> some View {
        VStack(spacing: Spacing.xs) {
            Text(name).typeStyle(TypeScale.label).foregroundStyle(mine ? Color.mine : Color.muted).lineLimit(1)
            Text(SeasonFormat.points(score))
                .font(.system(size: scoreSize, weight: .black).width(.compressed).monospacedDigit())
                .foregroundStyle(mine ? (passed || !skipping ? Color.mine : Color.text) : (done ? Color.muted : Color.text))
                .shadow(color: mine && passed ? Color.mine.opacity(0.5) : .clear, radius: 14)
                .lineLimit(1).minimumScaleFactor(0.5)
        }
        .frame(maxWidth: .infinity)
    }

    private var lineup: some View {
        VStack(spacing: Spacing.sm) {
            ForEach(Array(recap.starters.enumerated()), id: \.element.id) { i, p in
                StarterCard(player: p, star: at(6) && p.playerId == recap.star?.player.playerId)
                    .opacity(at(5) ? 1 : 0)
                    .offset(y: at(5) || still ? 0 : 28)
                    .rotation3DEffect(.degrees(at(5) || still ? 0 : 50), axis: (x: 1, y: 0, z: 0), anchor: .top)
                    .animation(still ? nil : .spring(duration: 0.45, bounce: 0.25).delay(Double(i) * Self.dealSeconds), value: at(5))
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Your starters")
    }

    private func starCard(_ star: WeekRecap.Star) -> some View {
        let p = star.player
        let gain = p.points - p.projected
        return VStack(spacing: Spacing.md) {
            Slab(text: "Star of the week", tone: .mine, ink: .mineInk, size: 20)
            Text(p.name.uppercased())
                .font(.system(size: starSize, weight: .black).width(.compressed))
                .foregroundStyle(Color.position(p.pos))
                .multilineTextAlignment(.center).minimumScaleFactor(0.6)
            Text([SlotLabel.of(p.pos), p.team ?? "FA", p.slot != p.pos ? "at \(SlotLabel.of(p.slot))" : nil].compactMap(\.self).joined(separator: " · "))
                .typeStyle(TypeScale.label).foregroundStyle(.muted)
            if star.beat {
                (Text("ESPN had him at ") + Text(SeasonFormat.points(p.projected)).bold() + Text(". He gave you ") + Text(SeasonFormat.points(p.points)).bold() + Text("."))
                    .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.text).multilineTextAlignment(.center)
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text("+" + SeasonFormat.points(at(6) ? gain : 0))
                        .font(.system(size: scoreSize * 0.8, weight: .black).width(.compressed).monospacedDigit())
                        .foregroundStyle(.mine)
                        .contentTransition(.numericText(value: at(6) ? gain : 0))
                        .animation(still ? nil : .easeOut(duration: 0.9).delay(0.42), value: at(6))
                    Text("over the call").typeStyle(TypeScale.label).foregroundStyle(.muted)
                }
            } else {
                (Text(SeasonFormat.points(p.points)).bold() + Text(" points, the most of your starters."))
                    .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.text)
            }
        }
        .padding(Spacing.xl * 1.5)
        .frame(maxWidth: .infinity)
        .background(Color.mine.opacity(at(6) ? 0.1 : 0), in: RoundedRectangle(cornerRadius: Radius.dialog))
        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(Color.mine.opacity(at(6) ? 0.5 : 0)))
        .opacity(at(6) ? 1 : 0)
        .scaleEffect(at(6) || still ? 1 : 0.9)
        .animation(still ? nil : .spring(duration: 0.55, bounce: 0.3), value: at(6))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(star.beat
            ? "Star of the week: \(p.name). ESPN had him at \(SeasonFormat.points(p.projected)); he gave you \(SeasonFormat.points(p.points)), \(SeasonFormat.points(gain)) over the call."
            : "Star of the week: \(p.name), \(SeasonFormat.points(p.points)) points, the most of your starters.")
    }

    private var actions: some View {
        VStack(spacing: Spacing.md) {
            if let card {
                ShareLink(item: card, preview: SharePreview(card.title, image: Image(uiImage: card.image))) {
                    Label("Share win card", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(StageButtonStyle())
                .accessibilityIdentifier("win-night-share")
            }
            Button("Back to Game day", action: onDone)
                .buttonStyle(ProviderButtonStyle())
                .accessibilityIdentifier("win-night-done")
        }
        .opacity(at(7) ? 1 : 0)
        .offset(y: at(7) || still ? 0 : 12)
        .animation(still ? nil : Motion.settle, value: at(7))
        .disabled(!at(7))
    }

    // MARK: Run of show

    private func scores(at date: Date) -> (Double, Double) {
        guard at(3) else { return (0, 0) }
        guard skipping, let raceStart else { return (recap.me, recap.them) }
        let level = Self.level(date.timeIntervalSince(raceStart) / Self.raceSeconds, top: max(recap.me, recap.them, 1))
        return (min(recap.me, level), min(recap.them, level))
    }

    private func run() async {
        if still {
            beat = Self.finalBeat
            passed = true
            withAnimation(Motion.fade) { shown = true }
            return
        }
        shown = true
        let marks = Self.beats(starters: recap.starters.count)
        let start = Date.now
        for (i, mark) in marks.enumerated() {
            let wait = mark - Date.now.timeIntervalSince(start)
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            guard !Task.isCancelled, beat <= i else { return }
            beat = i + 1
            if beat == 3 { raceStart = .now; Task { await pass() } }
        }
    }

    /// The moment the user's score runs past the opponent's.
    private func pass() async {
        guard let t = Self.passMoment(me: recap.me, them: recap.them) else { return }
        try? await Task.sleep(for: .seconds(t * Self.raceSeconds))
        withAnimation(Motion.respond) { passed = true }
    }

    private func skip() {
        withAnimation(.smooth(duration: 0.35)) {
            beat = Self.finalBeat
            passed = true
        }
    }
}

/// One starter dealt face up: slot in his position's hue, his name and team, his points in green when
/// he beat his projection and soft red under 70% of it.
private struct StarterCard: View {
    let player: WeekRecap.Starter
    let star: Bool

    var body: some View {
        let hue = Color.position(player.pos)
        HStack(spacing: Spacing.md) {
            Text(SlotLabel.of(player.slot)).typeStyle(TypeScale.micro).foregroundStyle(hue)
                .frame(width: 44).padding(.vertical, Spacing.xs)
                .background(hue.opacity(0.18), in: RoundedRectangle(cornerRadius: Radius.sm))
            VStack(alignment: .leading, spacing: 1) {
                Text(player.name).typeStyle(TypeScale.body).foregroundStyle(.text).lineLimit(1)
                Text("\(player.team ?? "FA") · proj \(SeasonFormat.points(player.projected))").typeStyle(TypeScale.label).foregroundStyle(.muted).monospacedDigit()
            }
            Spacer(minLength: Spacing.md)
            Text(SeasonFormat.points(player.points))
                .font(.system(.title3, weight: .black).width(.compressed).monospacedDigit())
                .foregroundStyle(player.points >= player.projected ? Color.mine : player.points < player.projected * 0.7 ? Color.softRed : Color.text)
        }
        .padding(.horizontal, Spacing.lg).padding(.vertical, Spacing.md)
        .background(star ? Color.mine.opacity(0.14) : Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: Radius.xl))
        .overlay(RoundedRectangle(cornerRadius: Radius.xl).stroke(star ? Color.mine.opacity(0.6) : .clear))
        .animation(Motion.respond, value: star)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(SlotLabel.of(player.slot)), \(player.name), \(SeasonFormat.points(player.points)) points, projected \(SeasonFormat.points(player.projected))")
    }
}

/// Two follow-spots from the floor's corners that swing in onto the star.
private struct Beams: View {
    let converge: Bool

    var body: some View {
        GeometryReader { geo in
            ZStack {
                beam(lean: 1, size: geo.size).position(x: 0, y: geo.size.height)
                beam(lean: -1, size: geo.size).position(x: geo.size.width, y: geo.size.height)
            }
        }
        .animation(.spring(duration: 1.1, bounce: 0.15), value: converge)
    }

    private func beam(lean: Double, size: CGSize) -> some View {
        LinearGradient(colors: [.white.opacity(0.13), .white.opacity(0)], startPoint: .bottom, endPoint: .top)
            .frame(width: size.width * 0.5, height: size.height * 1.6)
            .mask(Trapezoid())
            .rotationEffect(.degrees(lean * (converge ? 14 : 30)), anchor: .bottom)
            .offset(y: -size.height * 0.8)
    }

    private struct Trapezoid: Shape {
        func path(in rect: CGRect) -> Path {
            Path { p in
                p.move(to: CGPoint(x: rect.midX - 8, y: rect.maxY))
                p.addLine(to: CGPoint(x: rect.midX + 8, y: rect.maxY))
                p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
                p.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
                p.closeSubpath()
            }
        }
    }
}

/// Confetti over the star: one burst that falls, sways and spins for about four seconds, then stops.
private struct Confetti: View {
    private struct Piece {
        let x: Double, speed: Double, sway: Double, spin: Double, delay: Double, size: CGSize, color: Color
    }

    private static let colors: [Color] = [.mine, .sky, .gold, .valueInk, .text]
    private let pieces: [Piece] = (0 ..< 110).map { i in
        Piece(x: .random(in: 0 ... 1), speed: .random(in: 0.45 ... 0.9), sway: .random(in: 8 ... 26), spin: .random(in: 2 ... 7),
              delay: .random(in: 0 ... 0.5), size: CGSize(width: .random(in: 5 ... 9), height: .random(in: 8 ... 14)), color: colors[i % colors.count])
    }
    @State private var start = Date.now
    private let life = 4.2

    var body: some View {
        TimelineView(.animation(paused: Date.now.timeIntervalSince(start) > life)) { context in
            Canvas { ctx, size in
                let t = context.date.timeIntervalSince(start)
                for p in pieces {
                    let age = t - p.delay
                    guard age > 0, age < life else { continue }
                    let y = -20 + age * p.speed * size.height * 0.5 + 0.5 * 140 * age * age * p.speed
                    guard y < size.height + 20 else { continue }
                    let x = p.x * size.width + sin(age * 2.4 + p.x * 9) * p.sway
                    var piece = ctx
                    piece.opacity = max(0, 1 - max(0, age - (life - 1)) / 1)
                    piece.translateBy(x: x, y: y)
                    piece.rotate(by: .radians(age * p.spin))
                    piece.scaleBy(x: cos(age * p.spin * 1.3), y: 1)
                    piece.fill(Path(CGRect(x: -p.size.width / 2, y: -p.size.height / 2, width: p.size.width, height: p.size.height)), with: .color(p.color))
                }
            }
        }
        .accessibilityHidden(true)
    }
}

#if DEBUG
#Preview {
    WinNight(recap: SeasonSample.finalResult.recap, league: "App Tester") {}
}
#endif
