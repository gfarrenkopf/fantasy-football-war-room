import SwiftUI

/// Connect an ESPN league, in a sheet: consent, ESPN's sign-in, the league, done. The only ESPN
/// branding anywhere is the text "Works with ESPN Fantasy" (docs/ios.md §2).
struct EspnConnectView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var model: EspnConnectModel?
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
            }

        case .signingIn:
            VStack(spacing: 0) {
                EspnSignInView { login in
                    Task { await model.signedIn(login) }
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
            ConnectedView(name: name) {
                onConnected(connected.leagueId)
                dismiss()
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

/// The success moment: a ring draws itself closed, the check lands with a haptic, then the league opens.
private struct ConnectedView: View {
    let name: String
    let onContinue: () -> Void
    @State private var drawn = false

    var body: some View {
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
            VStack(spacing: Spacing.sm) {
                Text("Connected").typeStyle(TypeScale.headline).foregroundStyle(.text)
                Text("\(name) is in Draft Room. Your lineup, trades and the waiver wire are a tap away.")
                    .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                    .multilineTextAlignment(.center)
            }
            Button("Open my league", action: onContinue)
                .buttonStyle(ProviderButtonStyle(prominent: true))
                .accessibilityIdentifier("espn-open-league")
        }
        .padding(Spacing.xl * 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sensoryFeedback(Haptic.success, trigger: drawn)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.7)) { drawn = true }
        }
    }
}
