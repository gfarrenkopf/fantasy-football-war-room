import AuthenticationServices
import SwiftUI

/// The way in, and the app's first impression (APE-417). Two zones: the promise on the room's ground,
/// and the ways in on a panel docked at the bottom. The promise is a week already won, the way the
/// web's season door shows it: the league's scoreboard sits behind the brand, YOU WON stamps, the
/// score climbs from what the lineup by rank scored to the final, and the two calls that did it land
/// as swaps. A sent link flies off as an envelope, like the web's sign-in.
struct SignInView: View {
    @Environment(Session.self) private var session
    @Environment(\.webAuthenticationSession) private var webAuthentication
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model: SignInModel?
    @State private var shown = false
    /// The win's beats: 1, YOU WON stamps; 2, the score climbs and the calls land.
    @State private var beat = 0
    /// Email is the third way in, folded behind one button until it's wanted.
    @State private var emailOpen = false
    @FocusState private var emailFocused: Bool

    var body: some View {
        Group {
            if let model {
                content(model)
            } else {
                Color.clear
            }
        }
        .background(alignment: .top) {
            LeagueBackdrop(shown: shown, still: reduceMotion)
        }
        .background(.bg)
        .task {
            if model == nil { model = SignInModel(session: session) }
            if reduceMotion {
                shown = true
                beat = 2
                return
            }
            withAnimation(Motion.settle.delay(0.1)) { shown = true }
            try? await Task.sleep(for: .milliseconds(550))
            withAnimation(.spring(duration: 0.35, bounce: 0.4)) { beat = 1 }
            try? await Task.sleep(for: .milliseconds(250))
            withAnimation(.easeOut(duration: 0.9)) { beat = 2 }
        }
        .onOpenURL { url in
            Task { await model?.handle(url) }
        }
    }

    @ViewBuilder
    private func content(_ model: SignInModel) -> some View {
        GeometryReader { room in
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl + Spacing.md) {
                    header
                        .offset(y: shown ? 0 : 12)
                        .opacity(shown ? 1 : 0)
                    WinProof(beat: beat)
                }
                .padding(.horizontal, Spacing.xl + Spacing.sm)
                .padding(.vertical, Spacing.xl * 2)
                // Centered in the room above the panel on a tall phone; scrolls on a short one.
                .frame(minHeight: room.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            // On the promise only: set outside the panel too, it would replace the panel controls' own ids.
            .accessibilityIdentifier("signin")
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            panel(model)
        }
        .disabled(model.busy)
        .overlay {
            if model.busy {
                ProgressView().controlSize(.large).tint(.text)
            }
        }
    }

    @ScaledMetric(relativeTo: .largeTitle) private var wordmarkSize: CGFloat = 36
    @ScaledMetric(relativeTo: .title) private var thesisSize: CGFloat = 25

    /// The brand in the room's stage face (the recaps' YOU WON), then the web season door's promise:
    /// the user wins, Draft Room is the analyst.
    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.md + Spacing.xs) {
            HStack(spacing: Spacing.lg) {
                BrandMark(lit: beat >= 1)
                    .frame(width: wordmarkSize * 1.05, height: wordmarkSize * 1.05)
                Text("Draft Room")
                    .font(.system(size: wordmarkSize, weight: .black).width(.compressed))
                    .textCase(.uppercase)
                    .tracking(1)
                    .foregroundStyle(.text)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            (Text("You play to win the game.\n") + Text("We make sure you start the team that does.").foregroundStyle(.mine))
                .font(.system(size: thesisSize, weight: .bold))
                .tracking(-0.3)
                .lineSpacing(2)
                .foregroundStyle(.text)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// The ways in, on their own surface so the promise and the action read as two things.
    @ViewBuilder
    private func panel(_ model: SignInModel) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md + Spacing.xs) {
            switch model.step {
            case .choose:
                choices(model)
                    .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .leading).combined(with: .opacity)))
            case let .checkInbox(address):
                InboxView(address: address) {
                    withAnimation(Motion.respond) { model.step = .choose }
                }
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }

            if let message = model.errorMessage {
                Text(message)
                    .typeStyle(TypeScale.label)
                    .foregroundStyle(.reachInk)
                    .accessibilityIdentifier("signin-error")
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, Spacing.xl + Spacing.sm)
        .padding(.top, Spacing.xl + Spacing.sm)
        .padding(.bottom, Spacing.lg)
        .frame(maxWidth: .infinity)
        .background {
            UnevenRoundedRectangle(topLeadingRadius: 22, topTrailingRadius: 22)
                .fill(.panel)
                .overlay(alignment: .top) {
                    UnevenRoundedRectangle(topLeadingRadius: 22, topTrailingRadius: 22).stroke(Color.line2)
                }
                .shadow(color: .black.opacity(0.35), radius: 18, y: -6)
                .ignoresSafeArea(edges: .bottom)
        }
        .offset(y: shown ? 0 : 40)
        .opacity(shown ? 1 : 0)
        .animation(Motion.respond, value: model.step)
        .animation(Motion.respond, value: emailOpen)
        .animation(.easeOut(duration: 0.2), value: model.errorMessage)
    }

    @ViewBuilder
    private func choices(_ model: SignInModel) -> some View {
        @Bindable var model = model
        VStack(spacing: Spacing.md + Spacing.xs) {
            // The nudge: the one step after signing in.
            Text("Sign in, then connect your ESPN league.")
                .typeStyle(TypeScale.body)
                .fontWeight(.regular)
                .foregroundStyle(.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)

            SignInWithAppleButton(.continue, onRequest: model.prepare) { result in
                Task { await model.finishApple(result) }
            }
            .signInWithAppleButtonStyle(.white)
            .frame(height: 50)
            .clipShape(RoundedRectangle(cornerRadius: Radius.dialog))
            .rise(shown, order: 1)

            Button {
                Task { await signInWithGoogle(model) }
            } label: {
                HStack(spacing: Spacing.md) {
                    Image("GoogleMark").resizable().frame(width: 18, height: 18)
                    Text("Continue with Google")
                }
            }
            .buttonStyle(ProviderButtonStyle())
            .rise(shown, order: 2)

            if emailOpen {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    TextField("you@example.com", text: $model.email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.send)
                        .focused($emailFocused)
                        .onSubmit { if model.emailLooksValid { Task { await model.sendLink() } } }
                        .padding(.horizontal, Spacing.xl)
                        .frame(height: 50)
                        .background(.bg, in: RoundedRectangle(cornerRadius: Radius.dialog))
                        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(emailFocused ? Color.focus : Color.line))
                        .foregroundStyle(.text)
                        .accessibilityIdentifier("signin-email")

                    Button("Email me a sign-in link") {
                        Task { await model.sendLink() }
                    }
                    .buttonStyle(ProviderButtonStyle(prominent: true))
                    .disabled(!model.emailLooksValid)

                    Text("No password. The link signs you in on this phone.")
                        .typeStyle(TypeScale.label)
                        .foregroundStyle(.dim)
                }
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            } else {
                Button {
                    emailOpen = true
                    emailFocused = true
                } label: {
                    Label("Continue with email", systemImage: "envelope")
                }
                .buttonStyle(ProviderButtonStyle())
                .rise(shown, order: 3)
            }
        }
    }

    private func signInWithGoogle(_ model: SignInModel) async {
        let start = model.googleStart
        do {
            let url = try await webAuthentication.authenticate(using: start.url, callback: start.callback, preferredBrowserSession: .ephemeral, additionalHeaderFields: [:])
            await model.finishGoogle(callbackURL: url)
        } catch {
            model.googleFailed(error)
        }
    }
}

/// The app icon's mark, drawn rather than shipped as an image: one lit board, three rows, and the one
/// that's yours carries the mine card's rail and green (`src/app/icon.svg`, on a 32-unit grid). The
/// tile is the room's ground with a hairline, so the mark reads as a tile on the same ground. Its row
/// lights when YOU WON stamps; until then it's an unlit row like the others.
private struct BrandMark: View {
    let lit: Bool

    var body: some View {
        GeometryReader { box in
            let u = box.size.width / 32
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 7 * u).fill(.bg)
                RoundedRectangle(cornerRadius: 7 * u).strokeBorder(Color.line2, lineWidth: 1)
                row(u, y: 6.5, width: 19, fill: .line2)
                row(u, y: 13.5, width: 19, fill: lit ? Color.mine.opacity(0.32) : .line2)
                row(u, y: 13.5, width: 3.5, fill: lit ? .mine : .line2)
                row(u, y: 20.5, width: 12, fill: .line2)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .animation(.easeOut(duration: 0.45), value: lit)
        .accessibilityHidden(true)
    }

    private func row(_ u: CGFloat, y: CGFloat, width: CGFloat, fill: Color) -> some View {
        RoundedRectangle(cornerRadius: 1.25 * u)
            .fill(fill)
            .frame(width: width * u, height: 5 * u)
            .offset(x: 6.5 * u, y: y * u)
    }
}

/// The web season door's sample week (`src/lib/data/season-sample-2026.json`, APE-340): marketing,
/// not a feed. The final and the two calls are the web WinCard's; the scoreboard is its backdrop's.
private enum SampleWeek {
    static let you = 130.5
    static let opponent = 112.9
    /// What Draft Room's two calls added: Allen over Corum (23.2 to 4.1), Doubs over Meyers (16.8 to 7.6).
    static let worth = (23.2 - 4.1) + (16.8 - 7.6)
    /// The same lineup set by rank: a loss.
    static var byRank: Double { you - worth }

    struct Call {
        let slot: String
        let color: Color
        let start: String
        let bench: String
        let gain: Double
    }

    static let calls = [
        Call(slot: "RB", color: .rb, start: "B. Allen", bench: "B. Corum", gain: 23.2 - 4.1),
        Call(slot: "WR", color: .wr, start: "R. Doubs", bench: "J. Meyers", gain: 16.8 - 7.6),
    ]
    static let scoreboard: [(home: String, away: String, homeScore: Double, awayScore: Double)] = [
        ("Hurts So Good", "Tua Legit to Quit", 136.6, 118.9),
        ("Kelce Grammer", "Bijan Mustard", 95.3, 138.1),
        ("Ja'Marr the Merrier", "Saquon Me Later", 116.9, 111.8),
        ("Nacho Average Team", "Lamar Your Business", 99.6, 94.8),
        ("Waddle Waddle", "Gibbs Me a Break", 115.6, 138.7),
    ]
}

/// The week already won, the web WinCard in brief: YOU WON stamps, the score climbs from what the
/// lineup by rank scored to the final, and the two calls that made the difference land as swaps,
/// each the starter Draft Room put in, the one it benched, and what the change was worth.
private struct WinProof: View {
    let beat: Int
    @ScaledMetric(relativeTo: .largeTitle) private var wordSize: CGFloat = 40
    @ScaledMetric(relativeTo: .title) private var scoreSize: CGFloat = 28

    private var score: Double { beat >= 2 ? SampleWeek.you : SampleWeek.byRank }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.lg) { word; final }
                VStack(alignment: .leading, spacing: Spacing.xs) { word; final }
            }
            VStack(spacing: Spacing.md) {
                ForEach(SampleWeek.calls.indices, id: \.self) { i in
                    SwapRow(call: SampleWeek.calls[i])
                        .opacity(beat >= 2 ? 1 : 0)
                        .offset(x: beat >= 2 ? 0 : 16)
                        .animation(Motion.settle.delay(0.35 + Double(i) * 0.15), value: beat)
                }
            }
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.value.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.dialog))
        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(Color.value.opacity(0.45)))
        .opacity(beat >= 1 ? 1 : 0)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "A sample week: you won \(SeasonFormat.points(SampleWeek.you)) to \(SeasonFormat.points(SampleWeek.opponent)). "
                + SampleWeek.calls.map { "Draft Room started \($0.start) over \($0.bench), worth \(SeasonFormat.points($0.gain)) points." }.joined(separator: " ")
        )
    }

    private var word: some View {
        Text("You won")
            .font(.system(size: wordSize, weight: .black).width(.compressed))
            .textCase(.uppercase)
            .foregroundStyle(.valueInk)
            .lineLimit(1)
            .scaleEffect(beat >= 1 ? 1 : 1.5, anchor: .leading)
    }

    private var final: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
            Text(SeasonFormat.points(score))
                .foregroundStyle(.text)
                .contentTransition(.numericText(value: score))
            Text("–").foregroundStyle(.dim)
            Text(SeasonFormat.points(SampleWeek.opponent)).foregroundStyle(.muted)
        }
        .font(.system(size: scoreSize, weight: .bold).width(.compressed).monospacedDigit())
        .lineLimit(1)
    }
}

/// One of Draft Room's calls as a swap: the slot in its position's color, the player started, the one
/// benched struck through, and the points the change won.
private struct SwapRow: View {
    let call: SampleWeek.Call
    @ScaledMetric(relativeTo: .title3) private var gainSize: CGFloat = 22

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text(call.slot)
                .typeStyle(TypeScale.micro)
                .foregroundStyle(call.color)
                .frame(minWidth: 34, minHeight: 24)
                .background(call.color.opacity(0.16), in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Radius.md).stroke(call.color.opacity(0.5)))
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.sm) { started; swap; benched }
                VStack(alignment: .leading, spacing: 2) { started; benched }
            }
            Spacer(minLength: Spacing.sm)
            Text(SeasonFormat.signed(call.gain))
                .font(.system(size: gainSize, weight: .bold).width(.compressed).monospacedDigit())
                .foregroundStyle(.valueInk)
        }
    }

    private var started: some View {
        Text(call.start).typeStyle(TypeScale.title).foregroundStyle(.text).lineLimit(1)
    }

    private var swap: some View {
        Image(systemName: "arrow.left.arrow.right").font(.caption.weight(.semibold)).foregroundStyle(.dim)
    }

    private var benched: some View {
        Text(call.bench).typeStyle(TypeScale.body).fontWeight(.regular).strikethrough(color: .dim).foregroundStyle(.dim).lineLimit(1)
    }
}

/// The rest of the league's week behind the brand, matchup by matchup, as the web season door runs
/// its backdrop: set dressing, so hidden from VoiceOver, faint, and fading out before the win card. The tiles deal in once and then hold still.
private struct LeagueBackdrop: View {
    let shown: Bool
    let still: Bool

    private static let tiles: [(home: String, away: String, homeScore: Double, awayScore: Double)] = (0..<14).map { i in
        let game = SampleWeek.scoreboard[(i + i / 4) % SampleWeek.scoreboard.count]
        // Each pass round the league is another week: nudge the scores so repeats don't read as copies.
        let lap = Double(i / SampleWeek.scoreboard.count)
        func nudge(_ n: Double, _ k: Double) -> Double { ((n + (lap * 7.3 + k * 3.1).truncatingRemainder(dividingBy: 19) - 9) * 10).rounded() / 10 }
        return (game.home, game.away, nudge(game.homeScore, Double(i)), nudge(game.awayScore, Double(i + 2)))
    }

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: Spacing.md), GridItem(.flexible(), spacing: Spacing.md)], spacing: Spacing.md) {
            ForEach(Self.tiles.indices, id: \.self) { i in
                tile(Self.tiles[i])
                    .opacity(shown ? 1 : 0)
                    .animation(still ? nil : .easeOut(duration: 0.5).delay(min(Double(i) * 0.03, 0.4)), value: shown)
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.top, Spacing.md)
        .opacity(0.32)
        .mask {
            // Dim under the status bar, strongest behind the brand, gone before the win card.
            LinearGradient(stops: [.init(color: .black.opacity(0.15), location: 0), .init(color: .black, location: 0.14), .init(color: .black.opacity(0.5), location: 0.28), .init(color: .clear, location: 0.45)], startPoint: .top, endPoint: .bottom)
        }
        .ignoresSafeArea(edges: .top)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func tile(_ t: (home: String, away: String, homeScore: Double, awayScore: Double)) -> some View {
        let homeWins = t.homeScore >= t.awayScore
        return VStack(alignment: .leading, spacing: Spacing.xs) {
            row(t.home, t.homeScore, lead: homeWins)
            row(t.away, t.awayScore, lead: !homeWins)
            GeometryReader { box in
                Capsule().fill(Color.line)
                    .overlay(alignment: .leading) {
                        Capsule().fill(Color.dim).frame(width: box.size.width * t.homeScore / (t.homeScore + t.awayScore))
                    }
            }
            .frame(height: 2)
        }
        .padding(Spacing.md)
        .background(.panel, in: RoundedRectangle(cornerRadius: Radius.xl))
        .overlay(RoundedRectangle(cornerRadius: Radius.xl).stroke(Color.line))
    }

    private func row(_ name: String, _ score: Double, lead: Bool) -> some View {
        HStack(spacing: Spacing.sm) {
            Text(name).lineLimit(1)
            Spacer(minLength: Spacing.xs)
            Text(SeasonFormat.points(score)).monospacedDigit().fontWeight(.bold)
        }
        .font(.caption)
        .foregroundStyle(lead ? Color.text : Color.dim)
    }
}

/// "Check your inbox": the envelope lands, the address is confirmed, and Mail is a tap away.
private struct InboxView: View {
    let address: String
    let onChangeAddress: () -> Void
    @Environment(\.openURL) private var openURL
    @State private var landed = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Image(systemName: landed ? "envelope.badge" : "paperplane")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.sky)
                .contentTransition(.symbolEffect(.replace))
                .offset(x: landed ? 0 : -40, y: landed ? 0 : 20)
                .padding(.bottom, Spacing.sm)
            Text("Check your inbox.")
                .typeStyle(TypeScale.title)
                .foregroundStyle(.text)
            (Text("A sign-in link is on its way to ") + Text(address).foregroundStyle(.text).bold() + Text(". Open it on this phone and the app signs you in."))
                .typeStyle(TypeScale.body)
                .fontWeight(.regular)
                .foregroundStyle(.muted)
                .fixedSize(horizontal: false, vertical: true)
            Button("Open Mail") {
                if let mail = URL(string: "message://") { openURL(mail) }
            }
            .buttonStyle(ProviderButtonStyle(prominent: true))
            .padding(.top, Spacing.sm)
            Button("Use a different address", action: onChangeAddress)
                .typeStyle(TypeScale.label)
                .foregroundStyle(.muted)
        }
        .sensoryFeedback(Haptic.success, trigger: landed)
        .onAppear {
            withAnimation(.spring(duration: 0.6, bounce: 0.35).delay(0.15)) { landed = true }
        }
        .accessibilityIdentifier("signin-inbox")
    }
}

/// The sign-in buttons other than Apple's own: the same height and corners, in the room's colors.
struct ProviderButtonStyle: ButtonStyle {
    var prominent = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .typeStyle(TypeScale.title)
            .foregroundStyle(prominent ? Color.sky : Color.text)
            .multilineTextAlignment(.center)
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.lg)
            // At least 50 tall, and taller when the text needs two lines at the accessibility sizes.
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(configuration.isPressed ? Color.btnHover : Color.panel2, in: RoundedRectangle(cornerRadius: Radius.dialog))
            .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(prominent ? Color.skyLine : Color.line))
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

private extension View {
    /// Rises into place after the brand, one step after another.
    func rise(_ shown: Bool, order: Int) -> some View {
        offset(y: shown ? 0 : 16)
            .opacity(shown ? 1 : 0)
            .animation(Motion.stagger(order), value: shown)
    }
}

#Preview {
    SignInView()
        .environment(Session(api: APIClient(baseURL: URL(string: "http://localhost:3000")!)))
}
