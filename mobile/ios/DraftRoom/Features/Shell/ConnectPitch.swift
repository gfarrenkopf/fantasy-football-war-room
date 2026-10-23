import SwiftUI

/// No in-season leagues yet, the first screen after signing up (APE-440): an empty seat at the table.
/// The user's lineup waits with nothing in it, and a scan walks down it, lighting each starter's slot
/// in its position's color; once it's lit, the league's empty mark turns to the Connect button's sky.
/// Below it, the three tabs the league opens onto, each with what it does. Connect sits docked in the
/// thumb zone, as the sign-in's ways in do.
///
/// With Reduce Motion or VoiceOver on, the lineup is lit from the start, still.
struct ConnectPitchView: View {
    let onConnect: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var shown = false
    /// How many of the lineup's slots the scan has lit.
    @State private var lit = 0
    @ScaledMetric(relativeTo: .largeTitle) private var headlineSize: CGFloat = 40

    private var still: Bool { reduceMotion || voiceOver }
    private var ready: Bool { lit >= EmptyLineup.slots.count }

    var body: some View {
        GeometryReader { room in
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl + Spacing.sm) {
                    Text("Bring your\nleague in.")
                        .font(.system(size: headlineSize, weight: .black).width(.compressed))
                        .textCase(.uppercase)
                        .lineSpacing(-4)
                        .foregroundStyle(.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                        .rise(shown, order: 0)
                    Button(action: onConnect) {
                        EmptyLineup(lit: lit, ready: ready)
                    }
                    .buttonStyle(PressStyle())
                    .accessibilityLabel("Your lineup, waiting for your league. Connect a league.")
                    .rise(shown, order: 1)
                    VStack(alignment: .leading, spacing: Spacing.xl) {
                        Promise(tab: .lineup, line: "Set with you, every week").rise(shown, order: 2)
                        Promise(tab: .trade, line: "Weighed against everyone's real rosters").rise(shown, order: 3)
                        Promise(tab: .waivers, line: "The wire, watched for you").rise(shown, order: 4)
                    }
                }
                .padding(.horizontal, Spacing.xl + Spacing.sm)
                .padding(.top, Spacing.xl)
                .padding(.bottom, Spacing.xl * 2)
                .tabWidth()
                .frame(minHeight: room.size.height, alignment: .top)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { dock }
        .background(alignment: .top) {
            // The seat's own light: faint, from above the lineup, and only once it's lit.
            RadialGradient(colors: [Color.mine.opacity(ready ? 0.09 : 0), .clear], center: .center, startRadius: 4, endRadius: 260)
                .frame(height: 520)
                .offset(y: 60)
                .animation(.easeOut(duration: 0.8), value: ready)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        // Each slot lights with a soft tick, as cards dealt onto a table.
        .sensoryFeedback(.impact(flexibility: .soft, intensity: 0.45), trigger: lit) { _, now in now > 0 && !still }
        .task { await run() }
    }

    /// Connect, in reach of the thumb, with what it takes.
    private var dock: some View {
        VStack(spacing: Spacing.md) {
            Button("Connect a league", action: onConnect)
                .buttonStyle(ProviderButtonStyle(prominent: true))
                .accessibilityIdentifier("connect-league")
            Text("Sign in to ESPN and pick your league. Works with ESPN Fantasy.")
                .typeStyle(TypeScale.label)
                .foregroundStyle(.dim)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Spacing.xl + Spacing.sm)
        .padding(.top, Spacing.xl)
        .padding(.bottom, Spacing.md)
        .frame(maxWidth: .infinity)
        .background {
            Rectangle().fill(.bg)
                .overlay(alignment: .top) { Rectangle().fill(Color.line).frame(height: 1) }
                .ignoresSafeArea(edges: .bottom)
        }
        .offset(y: shown ? 0 : 24)
        .opacity(shown ? 1 : 0)
        .animation(Motion.stagger(1), value: shown)
    }

    private func run() async {
        guard !shown else { return }
        if still {
            shown = true
            lit = EmptyLineup.slots.count
            return
        }
        shown = true
        // The scan starts once the lineup has risen into place.
        try? await Task.sleep(for: .milliseconds(620))
        for _ in EmptyLineup.slots {
            withAnimation(Motion.respond) { lit += 1 }
            try? await Task.sleep(for: .milliseconds(110))
        }
    }
}

/// A lineup with no league in it yet: the league's mark an empty dashed circle, each starter's slot a
/// badge, and where the player and points go, blank bars. Lit slots take their position's color; the
/// slot being lit carries the scan.
private struct EmptyLineup: View {
    let lit: Int
    let ready: Bool
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .footnote) private var badgeWidth: CGFloat = 44

    /// The starters a lineup shows, for the picture only: no league's real shape.
    static let slots: [(label: String, color: Color, bar: CGFloat)] = [
        ("QB", .qb, 0.62), ("RB", .rb, 0.48), ("WR", .wr, 0.7), ("TE", .te, 0.44), ("FLEX", .flex, 0.58),
    ]

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Color.line).frame(height: 1)
            VStack(spacing: Spacing.xs) {
                ForEach(Self.slots.indices, id: \.self) { i in
                    row(Self.slots[i], on: i < lit, scanning: i == lit - 1 && !ready)
                }
            }
            .padding(Spacing.md)
        }
        .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(Color.line))
        .accessibilityElement(children: .ignore)
    }

    private var header: some View {
        HStack(spacing: Spacing.md) {
            ZStack {
                Circle().strokeBorder(ready ? Color.skyLine : Color.line2, style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                Image(systemName: "plus").font(.system(size: 11, weight: .bold)).foregroundStyle(ready ? Color.sky : Color.dim)
            }
            .frame(width: 26, height: 26)
            .scaleEffect(ready ? 1 : 0.9)
            .animation(.spring(duration: 0.45, bounce: 0.5), value: ready)
            Text("Your league").typeStyle(TypeScale.title).foregroundStyle(ready ? Color.text : Color.muted).lineLimit(1)
            Spacer(minLength: Spacing.sm)
            if !typeSize.isAccessibilitySize {
                Text("Starters").typeStyle(TypeScale.label).foregroundStyle(.dim)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.lg)
        .animation(.easeOut(duration: 0.4), value: ready)
    }

    private func row(_ slot: (label: String, color: Color, bar: CGFloat), on: Bool, scanning: Bool) -> some View {
        HStack(spacing: Spacing.md) {
            Text(slot.label)
                .typeStyle(TypeScale.micro)
                .foregroundStyle(on ? slot.color : Color.dim)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.horizontal, Spacing.xs)
                .frame(width: badgeWidth, height: 22 * badgeWidth / 44)
                .background(slot.color.opacity(on ? 0.16 : 0), in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Radius.md).stroke(on ? slot.color.opacity(0.5) : Color.line))
            GeometryReader { box in
                Capsule().fill(on ? Color.line2 : Color.line)
                    .frame(width: box.size.width * slot.bar, height: 7)
                    .frame(maxHeight: .infinity)
            }
            .frame(height: 22)
            Capsule().fill(on ? Color.line2 : Color.line).frame(width: 28, height: 7)
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.hair)
        .background(Color.mine.opacity(scanning ? 0.1 : 0), in: RoundedRectangle(cornerRadius: Radius.lg))
    }
}

/// One of the tabs the league opens onto, with its own symbol and what it does there.
private struct Promise: View {
    let tab: SeasonTab
    let line: String

    var body: some View {
        HStack(spacing: Spacing.lg + Spacing.xs) {
            Image(systemName: tab.symbol)
                .font(.system(.body, weight: .semibold))
                .foregroundStyle(.muted)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(tab.title).typeStyle(TypeScale.title).foregroundStyle(.text)
                Text(line).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The lineup's press: it gives a little under the finger, nothing more.
private struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

private extension View {
    /// Rises into place, one step after another.
    func rise(_ shown: Bool, order: Int) -> some View {
        offset(y: shown ? 0 : 16)
            .opacity(shown ? 1 : 0)
            .animation(Motion.stagger(order), value: shown)
    }
}

#if DEBUG
#Preview {
    NavigationStack { ConnectPitchView {} }
        .background(.bg)
}
#endif
