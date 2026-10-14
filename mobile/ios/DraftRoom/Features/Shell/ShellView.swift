import SwiftUI

/// The frame every signed-in screen lives in, after the web's "One Draft Room" shell (Epic 15):
/// the league up top with a switcher, the season's sections as tabs, the account behind the avatar.
struct ShellView: View {
    @Environment(Session.self) private var session
    @State private var model: ShellModel?
    @State private var tab: SeasonTab = .gameDay
    @State private var showingSettings = false
    @State private var connecting = false

    var body: some View {
        Group {
            if let model { content(model) } else { Color.bg }
        }
        .sheet(isPresented: $showingSettings) { SettingsView() }
        .sheet(isPresented: $connecting) {
            EspnConnectView { leagueId in
                Task { await model?.refresh(select: leagueId) }
            }
        }
        .task {
            guard model == nil else { return }
            let model = ShellModel(api: session.api)
            self.model = model
            await model.refresh()
        }
    }

    @ViewBuilder
    private func content(_ model: ShellModel) -> some View {
        if session.me?.flags.season != true {
            framed(model, title: "Draft Room") { SeasonClosedView() }
        } else {
            switch model.load {
            case .loading:
                ProgressView().tint(.muted).frame(maxWidth: .infinity, maxHeight: .infinity).background(.bg)
            case let .offline(message):
                framed(model, title: "Draft Room") {
                    OfflineView(message: message) { Task { await model.refresh() } }
                }
            case .ready:
                if let league = model.selected {
                    tabs(model, league: league)
                } else {
                    framed(model, title: "Draft Room") { ConnectPitchView { connecting = true } }
                }
            }
        }
    }

    private func tabs(_ model: ShellModel, league: League) -> some View {
        let store = model.season(for: league)
        return TabView(selection: $tab) {
            ForEach(SeasonTab.allCases) { section in
                Tab(section.title, systemImage: section.symbol, value: section) {
                    framed(model, title: league.name) {
                        switch section {
                        case .gameDay:
                            GameDayView(store: store, onLineup: { tab = .lineup }, onReconnect: { connecting = true })
                        default:
                            SeasonSectionView(section: section, league: league)
                        }
                    }
                }
                .accessibilityIdentifier("tab-\(section.rawValue)")
            }
        }
        .sensoryFeedback(Haptic.choice, trigger: tab)
        .sensoryFeedback(Haptic.choice, trigger: model.selectedId)
        // On a cold launch or a league switch, open the tab the week calls for (Lineup between
        // weeks, Game day otherwise); never while the user is moving around in a league.
        .task(id: league.id) {
            if let opening = store.openingTab { tab = opening }
            await store.start()
        }
        .onChange(of: store.openingTab) { _, opening in
            if let opening { tab = opening }
        }
    }

    /// A tab's navigation bar: the league switcher as the title, the account on the right.
    private func framed(_ model: ShellModel, title: String, @ViewBuilder content: () -> some View) -> some View {
        NavigationStack {
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.bg)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        LeagueSwitcher(model: model, title: title) { connecting = true }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showingSettings = true } label: {
                            AccountMark(email: session.me?.user.email)
                        }
                        .accessibilityLabel("Account")
                        .accessibilityIdentifier("open-settings")
                    }
                }
        }
    }
}

/// The league name, opening the user's leagues and "+ Connect a league". Uncluttered, like the web's league menu.
private struct LeagueSwitcher: View {
    let model: ShellModel
    let title: String
    let onConnect: () -> Void

    var body: some View {
        Menu {
            if !model.leagues.isEmpty {
                Section("Your leagues") {
                    ForEach(model.leagues) { league in
                        Button {
                            withAnimation(Motion.respond) { model.select(league.id) }
                        } label: {
                            if league.id == model.selected?.id {
                                Label(league.name, systemImage: "checkmark")
                            } else {
                                Text(league.name)
                            }
                        }
                    }
                }
            }
            Button("Connect a league", systemImage: "plus", action: onConnect)
        } label: {
            HStack(spacing: Spacing.xs) {
                Text(title).typeStyle(TypeScale.title).foregroundStyle(.text).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)).foregroundStyle(.muted)
            }
            .contentTransition(.opacity)
        }
        .accessibilityIdentifier("league-switcher")
    }
}

/// The user's initial in a ring, like the web's app bar.
private struct AccountMark: View {
    let email: String?

    var body: some View {
        Text(String((email ?? "?").prefix(1)).uppercased())
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.text)
            .frame(width: 30, height: 30)
            .background(.panel2, in: Circle())
            .overlay(Circle().stroke(.line2))
    }
}

// MARK: - Empty states

/// No in-season leagues yet: the reason to connect one.
private struct ConnectPitchView: View {
    let onConnect: () -> Void
    @State private var shown = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text("Bring your league in.").typeStyle(TypeScale.headline).foregroundStyle(.text)
            Text("Connect your ESPN league and Draft Room sets your lineup with you each week, weighs trades against everyone's real rosters, and watches the waiver wire.")
                .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                .fixedSize(horizontal: false, vertical: true)
            Button("Connect a league", action: onConnect)
                .buttonStyle(ProviderButtonStyle(prominent: true))
                .padding(.top, Spacing.sm)
                .accessibilityIdentifier("connect-league")
            Text("Works with ESPN Fantasy").typeStyle(TypeScale.label).foregroundStyle(.dim)
        }
        .padding(Spacing.xl + Spacing.sm)
        .offset(y: shown ? 0 : 12)
        .opacity(shown ? 1 : 0)
        .onAppear { withAnimation(Motion.settle) { shown = true } }
    }
}

/// In-season help isn't open to this account (APE-341): the same words as the web.
private struct SeasonClosedView: View {
    var body: some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: "lock").font(.system(size: 30, weight: .semibold)).foregroundStyle(.muted)
            Text("In-season help isn't available on your account yet. It's in a limited beta.")
                .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                .multilineTextAlignment(.center)
        }
        .padding(Spacing.xl * 2)
    }
}

private struct OfflineView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: "wifi.slash").font(.system(size: 30, weight: .semibold)).foregroundStyle(.muted)
            Text(message).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted).multilineTextAlignment(.center)
            Button("Try again", action: retry)
                .buttonStyle(ProviderButtonStyle(prominent: true))
                .frame(maxWidth: 240)
        }
        .padding(Spacing.xl * 2)
    }
}
