import SwiftUI

/// The frame every signed-in screen lives in, after the web's "One Draft Room" shell (Epic 15):
/// the league up top with a switcher, the season's sections as tabs, the account behind the avatar.
struct ShellView: View {
    @Environment(Session.self) private var session
    @State private var model: ShellModel?
    @State private var tab: SeasonTab = .gameDay
    @State private var showingSettings = false
    @State private var connecting = false
    /// A league switch, or connecting one, waiting on the user to discard unsaved lineup edits.
    @State private var pendingSwitch: PendingSwitch?
    /// Game day's stack: a recap opened from the archive or from a link.
    @State private var gameDayPath: [RecapKey] = []
    /// The recap a season link asked for, opened once its league is open.
    @State private var linkedRecap: RecapKey?
    /// The league a season link opened, which opens on Game day rather than the tab the week calls for.
    @State private var linkedLeague: String?

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
                    framed(model, title: league.name, path: section == .gameDay ? $gameDayPath : nil) {
                        switch section {
                        case .gameDay:
                            GameDayView(store: store, recaps: model.recaps(for: league), onLineup: { tab = .lineup }, onReconnect: { connecting = true })
                        case .lineup:
                            LineupView(model: model.lineup(for: league), fill: model.fill(for: league), onReconnect: { connecting = true }, onWaivers: { tab = .waivers })
                        case .trade:
                            TradesView(model: model.trades(for: league), onReconnect: { connecting = true })
                        case .waivers:
                            WaiversView(model: model.waivers(for: league), onReconnect: { connecting = true })
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
            if linkedLeague == league.id {
                tab = .gameDay
                if let key = linkedRecap { gameDayPath = [key] }
                linkedRecap = nil
            } else {
                gameDayPath = []
                if let opening = store.openingTab { tab = opening }
            }
            await store.start()
        }
        .onChange(of: store.openingTab) { _, opening in
            if let opening, linkedLeague != league.id { tab = opening }
        }
        .onChange(of: session.seasonLink, initial: true) { _, link in
            if let link { follow(link, model) }
        }
        .onChange(of: model.lineup(for: league).hasUnsavedEdits, initial: true) { _, unsaved in
            session.hasUnsavedLineup = unsaved
        }
        .confirmationDialog("Your lineup changes aren't saved to ESPN", isPresented: Binding { pendingSwitch != nil } set: { if !$0 { pendingSwitch = nil } }, titleVisibility: .visible) {
            Button("Discard changes", role: .destructive) {
                let pending = pendingSwitch
                pendingSwitch = nil
                switch pending {
                case let .league(id): withAnimation(Motion.respond) { model.select(id) }
                case .connect: connecting = true
                case nil: break
                }
            }
            Button("Keep editing", role: .cancel) {}
        }
    }

    /// Opens what a season link names: its league on Game day, and the week's recap when it names one.
    /// A link to a league this account doesn't follow is dropped.
    private func follow(_ link: SeasonLink, _ model: ShellModel) {
        session.seasonLink = nil
        guard model.leagues.contains(where: { $0.id == link.leagueId }) else { return }
        linkedLeague = link.leagueId
        if model.selected?.id == link.leagueId {
            tab = .gameDay
            gameDayPath = link.recap.map { [$0] } ?? []
        } else {
            linkedRecap = link.recap
            leave(to: .league(link.leagueId), model)
        }
    }

    /// Switches league, or opens Connect, asking first when the open league has unsaved lineup edits.
    private func leave(to pending: PendingSwitch, _ model: ShellModel) {
        if case let .league(id) = pending, id != linkedLeague { linkedLeague = nil }
        if model.hasUnsavedLineup {
            pendingSwitch = pending
            return
        }
        switch pending {
        case let .league(id): withAnimation(Motion.respond) { model.select(id) }
        case .connect: connecting = true
        }
    }

    /// A tab's navigation bar: the league switcher as the title, the account on the right.
    private func framed(_ model: ShellModel, title: String, path: Binding<[RecapKey]>? = nil, @ViewBuilder content: () -> some View) -> some View {
        NavigationStack(path: path ?? .constant([])) {
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.bg)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        LeagueSwitcher(model: model, title: title, onSelect: { leave(to: .league($0), model) }) { leave(to: .connect, model) }
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
private enum PendingSwitch: Equatable {
    case league(String)
    case connect
}

private struct LeagueSwitcher: View {
    let model: ShellModel
    let title: String
    let onSelect: (String) -> Void
    let onConnect: () -> Void

    var body: some View {
        Menu {
            if !model.leagues.isEmpty {
                Section("Your leagues") {
                    ForEach(model.leagues) { league in
                        Button {
                            if league.id != model.selected?.id { onSelect(league.id) }
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
