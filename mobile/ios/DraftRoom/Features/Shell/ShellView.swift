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
    /// The league a season link opened, which opens on Game day (or the link's tab) rather than the tab the week calls for.
    @State private var linkedLeague: String?
    /// The tab a season link asked for (a tapped push, 21.4), opened once its league is open.
    @State private var linkedTab: SeasonTab?
    /// Whether the standing strip is out of the way, while the user scrolls down a tab.
    @State private var standingBar = StandingBar()

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
            framed(model) { SeasonClosedView() }
        } else {
            switch model.load {
            case .loading:
                ProgressView().tint(.muted).frame(maxWidth: .infinity, maxHeight: .infinity).background(.bg)
            case let .offline(message):
                framed(model) {
                    OfflineView(message: message) { Task { await model.refresh() } }
                }
            case .ready:
                if let league = model.selected {
                    tabs(model, league: league)
                } else {
                    framed(model) { ConnectPitchView { connecting = true } }
                }
            }
        }
    }

    private func tabs(_ model: ShellModel, league: League) -> some View {
        let store = model.season(for: league)
        let holes = store.season?.gameDay.holes ?? []
        // Fill it on any tab: Lineup, with the fill sheet open on the hole (APE-418).
        let fillHole: (Hole) -> Void = { hole in
            tab = .lineup
            Task { await model.fill(for: league).open(hole) }
        }
        return TabView(selection: $tab) {
            ForEach(SeasonTab.allCases) { section in
                Tab(section.title, systemImage: section.symbol, value: section) {
                    framed(model, league: league, path: section == .gameDay ? $gameDayPath : nil) {
                        Group {
                            switch section {
                            case .gameDay:
                                GameDayView(store: store, recaps: model.recaps(for: league), onFill: fillHole, onReconnect: { connecting = true })
                            case .lineup:
                                LineupView(model: model.lineup(for: league), fill: model.fill(for: league), ai: model.ai(for: league), onReconnect: { connecting = true }, onWaivers: { tab = .waivers })
                            case .trade:
                                TradesView(model: model.trades(for: league), ai: model.ai(for: league), onReconnect: { connecting = true }, holes: holes, onFill: fillHole)
                            case .waivers:
                                WaiversView(model: model.waivers(for: league), onReconnect: { connecting = true }, onTrade: { partner, player in
                                    tab = .trade
                                    Task { await model.trades(for: league).load(partner: partner, gives: [], gets: [player]) }
                                }, holes: holes, onFill: fillHole)
                            }
                        }
                        // Where the user stands, over every tab (APE-432); the page scrolls under it.
                        .safeAreaBar(edge: .top) { StandingStrip(store: store, bar: standingBar) }
                        // Only the open tab's scrolling moves the strip.
                        .environment(section == tab ? standingBar : nil)
                    }
                }
                .accessibilityIdentifier("tab-\(section.rawValue)")
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        // Unsaved lineup changes follow the user to every tab, one tap from the review.
        .tabViewBottomAccessory(isEnabled: model.lineup(for: league).hasChanges) {
            ReviewAccessory(model: model.lineup(for: league)) {
                tab = .lineup
                Task { await model.lineup(for: league).review() }
            }
        }
        .sensoryFeedback(Haptic.choice, trigger: tab)
        .onChange(of: tab) { standingBar.reset() }
        .sensoryFeedback(Haptic.choice, trigger: model.selectedId)
        // On a cold launch or a league switch, open the tab the week calls for (Lineup between
        // weeks, Game day otherwise); never while the user is moving around in a league.
        .task(id: league.id) {
            standingBar.reset()
            if linkedLeague == league.id {
                tab = linkedTab ?? .gameDay
                if let key = linkedRecap { gameDayPath = [key] }
                linkedRecap = nil
                linkedTab = nil
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

    /// Opens what a season link names: its league on Game day (or the tab a push names, with the
    /// player's slot open), and the week's recap when it names one. A link to a league this account
    /// doesn't follow is dropped.
    private func follow(_ link: SeasonLink, _ model: ShellModel) {
        session.seasonLink = nil
        guard let league = model.leagues.first(where: { $0.id == link.leagueId }) else { return }
        linkedLeague = link.leagueId
        if let player = link.playerId { model.lineup(for: league).focus = player }
        if model.selected?.id == link.leagueId {
            tab = link.tab ?? .gameDay
            gameDayPath = link.recap.map { [$0] } ?? []
        } else {
            linkedRecap = link.recap
            linkedTab = link.tab
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

    /// A tab's navigation bar: the league switcher as the title, the account on the right. A tab
    /// with sections adds its jump menu on the left (`sectionJump()`).
    private func framed(_ model: ShellModel, league: League? = nil, path: Binding<[RecapKey]>? = nil, @ViewBuilder content: () -> some View) -> some View {
        NavigationStack(path: path ?? .constant([])) {
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.bg)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        LeagueSwitcher(model: model, league: league, onSelect: { leave(to: .league($0), model) }) { leave(to: .connect, model) }
                    }
                    .sharedBackgroundVisibility(.hidden)
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

/// What the user was leaving for when the unsaved-lineup prompt stopped them.
private enum PendingSwitch: Equatable {
    case league(String)
    case connect
}

/// The open league as a glass pill, like Messages' contact pill (APE-416): its mark, its name, the
/// menu chevron. Before a league is open it reads "Draft Room".
private struct LeagueSwitcher: View {
    let model: ShellModel
    let league: League?
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
            HStack(spacing: Spacing.sm) {
                if let league { LeagueMark(league: league) }
                Text(league?.shortName ?? "Draft Room").typeStyle(TypeScale.title).foregroundStyle(.text).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)).foregroundStyle(.muted)
            }
            .padding(.leading, league == nil ? Spacing.xl : Spacing.sm)
            .padding(.trailing, Spacing.xl)
            .frame(height: 38)
            .frame(maxWidth: 260)
            .glassEffect(.regular.interactive(), in: Capsule())
            .contentTransition(.opacity)
        }
        .accessibilityIdentifier("league-switcher")
    }
}

/// A league's initials on a color of its own, the same on every launch.
private struct LeagueMark: View {
    let league: League
    private static let palette: [Color] = [.qb, .rb, .wr, .te, .k, .flex]

    var body: some View {
        Text(league.monogram)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.bg)
            .frame(width: 24, height: 24)
            .background(Self.palette[league.markIndex(of: Self.palette.count)], in: Circle())
            .accessibilityHidden(true)
    }
}

extension League {
    /// The name as the switcher pill shows it: 12 characters at most, cut with an ellipsis (APE-431).
    /// The menu lists each league's full name.
    var shortName: String {
        let name = name.trimmingCharacters(in: .whitespaces)
        guard name.count > 12 else { return name }
        return name.prefix(12).trimmingCharacters(in: .whitespaces) + "…"
    }

    /// The league's initials: the first letters of its first two words, or a one-word name's first two.
    var monogram: String {
        let words = name.split { !$0.isLetter && !$0.isNumber }
        guard let first = words.first else { return "?" }
        let letters = words.count > 1 ? first.prefix(1) + words[1].prefix(1) : first.prefix(2)
        return letters.uppercased()
    }

    /// A steady pick among `count` colors: from the league's id, so it holds across launches
    /// (`hashValue` is seeded per launch).
    func markIndex(of count: Int) -> Int {
        let hash = id.unicodeScalars.reduce(UInt(5381)) { $0 &* 33 &+ UInt($1.value) }
        return Int(hash % UInt(count))
    }
}

/// The user's initial, on the toolbar's own glass circle.
private struct AccountMark: View {
    let email: String?

    var body: some View {
        Text(String((email ?? "?").prefix(1)).uppercased())
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.text)
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
