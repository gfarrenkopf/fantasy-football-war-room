import SwiftUI

/// Connect an ESPN league, in a sheet: consent, ESPN's sign-in, the league, done. The only ESPN
/// branding anywhere is the text "Works with ESPN Fantasy" (docs/ios.md §2).
struct EspnConnectView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var model: EspnConnectModel?
    /// MyDisney is on screen, so ESPN's page underneath can show.
    @State private var signInReady = false
    /// Whether this is the account's first league, which the success moment celebrates (APE-440).
    var firstLeague = false
    /// Called with the connected Draft Room league's id after the success moment.
    var onConnected: (String) -> Void = { _ in }

    var body: some View {
        NavigationStack {
            Group {
                if let model { content(model) } else { Color.clear }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(.bg)
            .navigationTitle("Connect a league")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if case .signingIn = model?.step {
                        Button("Back") { model?.cancelSignIn() }
                    } else {
                        Button("Cancel") { dismiss() }
                    }
                }
            }
        }
        .task {
            guard model == nil else { return }
            let model = EspnConnectModel(api: session.api)
            self.model = model
            await model.start()
        }
    }

    @ViewBuilder
    private func content(_ model: EspnConnectModel) -> some View {
        @Bindable var model = model
        switch model.step {
        case .loading, .connecting:
            VStack(spacing: Spacing.lg) {
                ProgressView().controlSize(.large).tint(.muted)
                if model.step == .connecting {
                    Text("Reading your league from ESPN…").typeStyle(TypeScale.label).foregroundStyle(.muted)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        case let .consent(disclosure):
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    Text("Works with ESPN Fantasy").typeStyle(TypeScale.micro).foregroundStyle(.dim).textCase(.uppercase)
                    Text("Before you connect").typeStyle(TypeScale.title).foregroundStyle(.text)
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        ForEach(disclosure.points, id: \.self) { point in
                            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                                Circle().fill(.dim).frame(width: 4, height: 4).alignmentGuide(.firstTextBaseline) { $0[.bottom] + 4 }
                                Text(point).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    if let message = model.errorMessage {
                        Text(message).typeStyle(TypeScale.label).foregroundStyle(.reachInk)
                    }
                    Button("I understand. Sign in to ESPN") { withAnimation(Motion.respond) { model.agree() } }
                        .buttonStyle(ProviderButtonStyle(prominent: true))
                        .padding(.top, Spacing.sm)
                        .accessibilityIdentifier("espn-agree")
                    Link("Privacy policy", destination: session.api.baseURL.appending(path: "privacy"))
                        .typeStyle(TypeScale.label)
                        .foregroundStyle(.muted)
                }
                .padding(Spacing.xl)
                .tabWidth()
            }

        case .signingIn:
            VStack(spacing: 0) {
                EspnSignInView(
                    onLogin: { login in Task { await model.signedIn(login) } },
                    onClose: { withAnimation(Motion.respond) { model.cancelSignIn() } },
                    onReady: { withAnimation(Motion.respond) { signInReady = true } }
                )
                // ESPN's page loads before MyDisney opens over it; cover it until MyDisney is up.
                .overlay {
                    if !signInReady {
                        VStack(spacing: Spacing.lg) {
                            ProgressView().controlSize(.large).tint(.muted)
                            Text("Opening ESPN sign-in…").typeStyle(TypeScale.label).foregroundStyle(.muted)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.bg)
                        .transition(.opacity)
                    }
                }
                .task {
                    signInReady = false
                    // Never leave the user behind the cover if MyDisney is slow or doesn't say so.
                    try? await Task.sleep(for: .seconds(15))
                    withAnimation(Motion.respond) { signInReady = true }
                }
                Text("Sign in with your ESPN account. Draft Room never sees your password.")
                    .typeStyle(TypeScale.label)
                    .foregroundStyle(.dim)
                    .padding(Spacing.md)
            }

        case let .pick(leagues):
            List {
                Section {
                    ForEach(leagues) { league in
                        Button {
                            Task { await model.choose(league) }
                        } label: {
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                Text(league.name).typeStyle(TypeScale.title).foregroundStyle(.text)
                                Text([league.teamName, String(league.season)].compactMap { $0 }.joined(separator: " · "))
                                    .typeStyle(TypeScale.label)
                                    .foregroundStyle(.muted)
                            }
                            .padding(.vertical, Spacing.xs)
                        }
                        .listRowBackground(Color.panel)
                    }
                } header: {
                    Text("Your ESPN leagues")
                } footer: {
                    if let message = model.errorMessage {
                        Text(message).foregroundStyle(.reachInk)
                    }
                }
            }
            .scrollContentBackground(.hidden)

        case let .enterLeague(listFailed):
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text("Which league?").typeStyle(TypeScale.title).foregroundStyle(.text)
                Text(listFailed
                    ? "ESPN didn't send your list of leagues. Try again, or paste the link to your league from ESPN, or its league id."
                    : "Paste the link to your league from ESPN, or its league id.")
                    .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                if listFailed {
                    Button("Load my leagues again") { Task { await model.loadLeagues() } }
                        .buttonStyle(ProviderButtonStyle(prominent: false))
                }
                TextField("fantasy.espn.com/football/league?leagueId=…", text: $model.leagueEntry)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, Spacing.xl)
                    .frame(height: 50)
                    .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
                    .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(.line))
                if let message = model.errorMessage {
                    Text(message).typeStyle(TypeScale.label).foregroundStyle(.reachInk)
                }
                Button("Connect") { Task { await model.connectEntered() } }
                    .buttonStyle(ProviderButtonStyle(prominent: true))
                    .disabled(model.leagueEntry.isEmpty)
            }
            .padding(Spacing.xl)

        case let .connected(connected, name):
            ConnectedView(leagueId: connected.leagueId, name: name, first: firstLeague) {
                onConnected(connected.leagueId)
                dismiss()
                // A league to be alerted about is the moment notifications make sense.
                Task { await session.push.askOnce() }
            }

        case let .failed(message):
            VStack(spacing: Spacing.lg) {
                Text(message).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted).multilineTextAlignment(.center)
                Button("Try again") { Task { await model.start() } }
                    .buttonStyle(ProviderButtonStyle(prominent: true))
                    .frame(maxWidth: 240)
            }
            .padding(Spacing.xl * 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// The success moment: a ring draws itself closed, the check lands with a haptic, then the league
/// rises on the switcher's own pill, its mark and color as the top of every tab will show them. A first
/// league gets the confetti too (APE-440). With Reduce Motion or VoiceOver on, it's all there at once.
private struct ConnectedView: View {
    let leagueId: String
    let name: String
    let first: Bool
    let onContinue: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var drawn = false
    @State private var landed = false

    private var still: Bool { reduceMotion || voiceOver }

    var body: some View {
        ZStack {
            VStack(spacing: Spacing.xl) {
                ZStack {
                    Circle().stroke(.line, lineWidth: 3)
                    Circle()
                        .trim(from: 0, to: drawn ? 1 : 0)
                        .stroke(.mine, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    Image(systemName: "checkmark")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(.mine)
                        .scaleEffect(drawn ? 1 : 0.3)
                        .opacity(drawn ? 1 : 0)
                }
                .frame(width: 88, height: 88)
                .accessibilityHidden(true)
                VStack(spacing: Spacing.sm) {
                    Text(first ? "You're in" : "Connected").typeStyle(TypeScale.headline).foregroundStyle(.text)
                        .accessibilityAddTraits(.isHeader)
                    Text("\(name) is in Draft Room. Your lineup, trades and the waiver wire are a tap away.")
                        .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(spacing: Spacing.sm) {
                    pill
                    Text("It's at the top of every tab.").typeStyle(TypeScale.label).foregroundStyle(.dim)
                }
                .offset(y: landed ? 0 : 18)
                .opacity(landed ? 1 : 0)
                Button("Open my league", action: onContinue)
                    .buttonStyle(ProviderButtonStyle(prominent: true))
                    .accessibilityIdentifier("espn-open-league")
            }
            .padding(Spacing.xl * 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            if first && landed && !still {
                Confetti().ignoresSafeArea().allowsHitTesting(false)
            }
        }
        .sensoryFeedback(Haptic.success, trigger: drawn) { _, now in now && !still }
        .task {
            if still {
                drawn = true
                landed = true
                return
            }
            withAnimation(.easeInOut(duration: 0.7)) { drawn = true }
            try? await Task.sleep(for: .milliseconds(750))
            withAnimation(Motion.settle) { landed = true }
        }
    }

    /// The league as the switcher shows it, without the menu: a picture of where it lives.
    private var pill: some View {
        HStack(spacing: Spacing.sm) {
            LeagueMark(id: leagueId, name: name)
            Text(League.shortName(of: name)).typeStyle(TypeScale.title).foregroundStyle(.text).lineLimit(1)
            Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)).foregroundStyle(.muted)
        }
        .padding(.leading, Spacing.sm)
        .padding(.trailing, Spacing.xl)
        .frame(height: 38)
        .glassEffect(.regular, in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name), at the top of every tab")
    }
}
