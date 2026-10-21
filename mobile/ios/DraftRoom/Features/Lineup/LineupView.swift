import SwiftUI

/// The Lineup tab (APE-382), after the web's LineupPanel: starters by slot, then the bench, the way
/// ESPN's roster screen lays them out. Tapping a slot or a bench player offers the legal swaps; the
/// review bar opens the save, which shows each change in the server's words before anything goes.
struct LineupView: View {
    let model: LineupModel
    /// Filling a hole from the hole card (APE-404).
    let fill: FillModel
    /// The AI lineup card (APE-391).
    let ai: AiModel
    /// Opens ESPN's sign-in again, when the league's ESPN login has lapsed.
    let onReconnect: () -> Void
    /// Opens the Waivers tab, for a pickup behind a doubtful starter.
    var onWaivers: () -> Void = {}

    @Environment(\.scenePhase) private var scenePhase
    @State private var pickingSeat: SeatPick?
    @State private var pickingBench: ViewPlayer?

    private var store: SeasonStore { model.store }

    var body: some View {
        Group {
            if let season = store.season, model.isReady {
                ScrollView {
                    VStack(spacing: Spacing.xl) {
                        if case let .problem(message, reconnect) = store.load {
                            ProblemNote(message: message, reconnect: reconnect, onReconnect: onReconnect) { Task { await store.refresh(force: true) } }
                        }
                        FreshnessNote(season: season, offline: store.offline)
                        if let save = model.lastSave, model.moment == nil || !save.allLanded {
                            SaveResults(save: save)
                        }
                        hero(week: season.view.currentWeek)
                            .jumpSection("This week")
                        HoleNotes(model: model, onWaivers: onWaivers)
                        StartersCard(model: model) { pickingSeat = SeatPick(seat: $0) }
                            .jumpSection("Starters")
                        BenchCard(model: model) { pickingBench = $0 }
                            .jumpSection("Bench")
                        MatchupCard(view: season.view)
                            .jumpSection("Week \(season.view.currentWeek) matchup")
                        AiLineupCard(ai: ai, lineup: model)
                            .jumpSection("AI lineup")
                    }
                    .padding(.horizontal, Spacing.xl + Spacing.xs)
                    .padding(.vertical, Spacing.xl)
                    .animation(Motion.respond, value: model.staged)
                    .animation(Motion.respond, value: model.ir)
                }
                .sectionJump()
                .refreshable {
                    await store.refresh(force: true)
                    await ai.refresh()
                }
            } else {
                switch store.load {
                case .loading, .ready:
                    // .ready with nothing staged yet: the season just arrived and staging catches up on this pass.
                    ProgressView().tint(.muted).frame(maxWidth: .infinity, maxHeight: .infinity)
                case let .problem(message, reconnect):
                    ProblemNote(message: message, reconnect: reconnect, onReconnect: onReconnect) { Task { await store.refresh(force: true) } }
                        .padding(Spacing.xl * 2)
                case let .failed(message):
                    FailedView(message: message) { Task { await store.refresh() } }
                }
            }
        }
        .background(.bg)
        // A container, so its id doesn't land on the review bar riding in the scroll view's inset.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("section-lineup")
        .sensoryFeedback(Haptic.choice, trigger: model.staged)
        .sensoryFeedback(Haptic.choice, trigger: model.ir)
        .onChange(of: store.season, initial: true) { model.sync() }
        .task { await ai.start() }
        // Back in the app: an AI lineup left writing may have finished.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, ai.working == nil { Task { await ai.refresh() } }
        }
        // A tapped "is out" push names a starter: open his slot's swaps.
        .onChange(of: model.focus, initial: true) { openFocus() }
        .onChange(of: model.isReady) { openFocus() }
        .sheet(item: $pickingSeat) { pick in SeatPicker(model: model, seat: pick.seat) }
        .sheet(item: $pickingBench) { player in BenchPicker(model: model, player: player) }
        .sheet(isPresented: saving) { SaveSheet(model: model) }
        .sheet(isPresented: filling) { FillSheet(model: fill, onWaivers: onWaivers) }
    }

    /// What leads the tab: the Lock In moment, the holes, Banked, or the start/sit verdict.
    @ViewBuilder private func hero(week: Int) -> some View {
        switch model.hero {
        case let .lockIn(moment):
            LockInCard(moment: moment, playing: model.momentIsNew, week: week, left: model.lineup?.startSit.swaps.count ?? 0) {
                Task { await model.finishDraftRoom() }
            }
        case let .holes(holes):
            HoleHero(model: model, holes: holes, week: week) { hole in Task { await fill.open(hole) } }
        case .banked:
            BankedHero(model: model, week: week)
        case .startSit:
            StartSitHero(model: model, week: week)
        case nil:
            EmptyView()
        }
    }

    /// The fill sheet is up from Fill it until the user closes it.
    private var filling: Binding<Bool> {
        Binding { fill.hole != nil } set: { shown in
            if !shown { fill.dismiss() }
        }
    }

    /// The save sheet is up from the consent until ESPN has answered.
    private var saving: Binding<Bool> {
        Binding {
            switch model.phase {
            case .idle, .saved: false
            default: true
            }
        } set: { shown in
            if !shown { model.cancel() }
        }
    }
}

extension LineupView {
    private func openFocus() {
        guard let id = model.focus, model.isReady else { return }
        model.focus = nil
        if let seat = model.staged.firstIndex(of: id) { pickingSeat = SeatPick(seat: seat) }
    }
}

private struct SeatPick: Identifiable {
    let seat: Int
    var id: Int { seat }
}

// MARK: - Starters and bench

private struct StartersCard: View {
    let model: LineupModel
    let onPick: (Int) -> Void

    var body: some View {
        let swaps = model.changedSeats.count
        let total = model.lineup?.startSit.currentTotal ?? 0
        SeasonCard(title: "Starters", note: (swaps == 0 ? "" : swaps == 1 ? "1 swap · " : "\(swaps) swaps · ") + "On ESPN \(SeasonFormat.points(total))") {
            VStack(spacing: 0) {
                Sources(model: model)
                ForEach(model.seats.indices, id: \.self) { seat in
                    Divider().overlay(.rowLine)
                    StarterRow(model: model, seat: seat) { onPick(seat) }
                }
            }
        }
    }
}

/// One tap back to ESPN's lineup or to Draft Room's (the web's LineupSources).
private struct Sources: View {
    let model: LineupModel

    var body: some View {
        if !(model.isOnEspn && model.isRecommended) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.xl) { links; Spacer(minLength: 0) }
                VStack(alignment: .leading, spacing: Spacing.md) { links }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .multilineTextAlignment(.leading)
            .typeStyle(TypeScale.label)
            .foregroundStyle(.sky)
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.lg)
        }
    }
}

extension Sources {
    @ViewBuilder fileprivate var links: some View {
        if !model.isOnEspn {
            Button("Start from ESPN's lineup") { model.startFromEspn() }
                .accessibilityIdentifier("start-from-espn")
        }
        if !model.isRecommended {
            Button("Start from Draft Room's lineup") { model.startFromDraftRoom() }
                .accessibilityIdentifier("start-from-draftroom")
        }
    }
}

/// A row's layout: slot, player and points side by side, stacked at the accessibility text sizes
/// so names keep their room.
private struct RowLayout<Slot: View, Player: View, Points: View>: View {
    @ViewBuilder var slot: () -> Slot
    @ViewBuilder var player: () -> Player
    @ViewBuilder var points: () -> Points
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        if size.isAccessibilitySize {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                slot()
                player()
                points()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack(alignment: .top, spacing: Spacing.md) {
                slot().frame(width: 40, alignment: .leading).padding(.top, 2)
                player().frame(maxWidth: .infinity, alignment: .leading)
                points()
            }
        }
    }
}

/// A slot's short name in the row's first column.
private struct SlotText: View {
    let text: String

    var body: some View {
        Text(text).typeStyle(TypeScale.micro).foregroundStyle(.muted).fixedSize()
    }
}

/// One starting seat: ESPN's player as set, and under him the player coming in, when that changes.
private struct StarterRow: View {
    let model: LineupModel
    let seat: Int
    let onTap: () -> Void

    var body: some View {
        let key = model.seats[seat]
        let now = model.player(model.onEspn[seat])
        let next = model.player(model.staged[seat])
        let changed = model.staged[seat] != model.onEspn[seat]
        let locked = model.isLocked(seat)
        let made = model.madeMove(at: seat)
        Button(action: onTap) {
            RowLayout {
                SlotBadge(key: key)
            } player: {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    if let now {
                        PlayerLine(player: now)
                        if let made { MadeMark(move: made) }
                    } else {
                        Text("Empty on ESPN").typeStyle(TypeScale.body).foregroundStyle(.dim)
                    }
                    if changed, let tag = now.flatMap({ model.lineup?.tag(of: $0.playerId) }) {
                        TagPill(tag: tag)
                    }
                    if changed {
                        SwapLine(next: next, gain: (next?.points ?? 0) - (now?.points ?? 0))
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
            } points: {
                RowPoints(player: now, locked: locked)
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.lg)
            .background(changed ? Color.sky.opacity(0.06) : made != nil ? Color.value.opacity(0.06) : .clear)
            .overlay(alignment: .leading) {
                if let made { MadeBar(fresh: model.freshlyMade.contains(made.playerId)) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(RowButtonStyle())
        .disabled(locked)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(spoken(key: key, now: now, next: next, changed: changed, locked: locked, made: made))
        .accessibilityHint(locked ? "" : "Shows who can play \(SlotLabel.of(key))")
        .accessibilityIdentifier("seat-\(seat)")
    }

    private func spoken(key: String, now: ViewPlayer?, next: ViewPlayer?, changed: Bool, locked: Bool, made: WarRoomMove?) -> String {
        var parts = [SlotLabel.of(key)]
        if let now {
            parts.append(now.name)
            parts.append("projected \(SeasonFormat.points(now.points))")
        } else {
            parts.append("empty on ESPN")
        }
        if locked { parts.append("locked") }
        if let made { parts.append("started by Draft Room, \(SeasonFormat.signed(made.gain)) projected") }
        if changed { parts.append(next.map { "swapping in \($0.name)" } ?? "leaving it empty") }
        return parts.joined(separator: ", ")
    }
}

/// Who comes into a seat, and what he does to the projection.
private struct SwapLine: View {
    let next: ViewPlayer?
    let gain: Double

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "arrow.turn.down.right").font(.system(size: 11, weight: .bold))
            Text(next?.name ?? "Leave empty").typeStyle(TypeScale.body).lineLimit(1)
            if let next { Text(SeasonFormat.points(next.points)).typeStyle(TypeScale.label).monospacedDigit().foregroundStyle(.muted) }
            Text(SeasonFormat.signed(gain)).typeStyle(TypeScale.label).monospacedDigit()
                .foregroundStyle(gain < 0 ? Color.reachInk : Color.valueInk)
        }
        .foregroundStyle(.sky)
    }
}

struct TagPill: View {
    let tag: SeasonLineup.Tag

    var body: some View {
        Text(tag.label).typeStyle(TypeScale.micro)
            .foregroundStyle(tag.kind == "out" ? Color.reachInk : Color.warnInk)
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, 1)
            .background((tag.kind == "out" ? Color.reach : Color.warn).opacity(0.14), in: Capsule())
    }
}

/// A player's projection, with a lock once his game has started (then what he's scored).
private struct RowPoints: View {
    let player: ViewPlayer?
    let locked: Bool
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        // Under the player at the accessibility sizes, so it lines up with him.
        VStack(alignment: size.isAccessibilitySize ? .leading : .trailing, spacing: 2) {
            if let player {
                if locked, let actual = player.actual {
                    Text(SeasonFormat.points(actual)).typeStyle(TypeScale.title).monospacedDigit().foregroundStyle(.text)
                    Text("proj \(SeasonFormat.points(player.points))").typeStyle(TypeScale.label).monospacedDigit().foregroundStyle(.dim)
                } else {
                    Text(SeasonFormat.points(player.points)).typeStyle(TypeScale.title).monospacedDigit().foregroundStyle(.text)
                    Text("proj").typeStyle(TypeScale.label).foregroundStyle(.dim)
                }
            }
            if locked {
                Image(systemName: "lock.fill").font(.system(size: 10, weight: .semibold)).foregroundStyle(.dim)
            }
        }
    }
}

private struct BenchCard: View {
    let model: LineupModel
    let onPick: (ViewPlayer) -> Void

    var body: some View {
        let bench = model.bench
        SeasonCard(title: "Bench", note: bench.count == 1 ? "1 player" : "\(bench.count) players") {
            VStack(spacing: 0) {
                ForEach(bench) { player in
                    Divider().overlay(.rowLine)
                    BenchRow(model: model, player: player) { onPick(player) }
                }
                let candidates = model.irCandidates
                if candidates.isEmpty {
                    ForEach(model.injuredReserve) { player in
                        Divider().overlay(.rowLine)
                        RowLayout {
                            SlotText(text: "IR")
                        } player: {
                            PlayerLine(player: player)
                        } points: {
                            RowPoints(player: player, locked: false)
                        }
                        .padding(.horizontal, Spacing.xl)
                        .padding(.vertical, Spacing.lg)
                        .accessibilityElement(children: .combine)
                    }
                } else {
                    IrList(model: model, candidates: candidates)
                }
            }
        }
    }
}

/// Who's on IR, and who could go there (the web's IrPicker): one toggle each, staged with the rest of
/// the lineup and saved through the same review. It stands in for the IR rows, so nobody shows twice.
private struct IrList: View {
    let model: LineupModel
    let candidates: [ViewPlayer]

    var body: some View {
        let over = model.ir.count > model.irSlots
        Divider().overlay(.rowLine)
        HStack {
            Text("IR · \(model.ir.count) of \(model.irSlots)")
                .typeStyle(TypeScale.micro).monospacedDigit()
                .foregroundStyle(over ? Color.warnInk : Color.muted)
            Spacer()
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.top, Spacing.lg)
        .padding(.bottom, Spacing.sm)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Injured reserve, \(model.ir.count) of \(model.irSlots) slots")
        .accessibilityAddTraits(.isHeader)
        ForEach(candidates) { player in
            IrRow(model: model, player: player)
        }
    }
}

private struct IrRow: View {
    let model: LineupModel
    let player: ViewPlayer

    var body: some View {
        let on = model.ir.contains(player.playerId)
        let wasOn = player.slot == "IR"
        let moving = on != wasOn
        Toggle(isOn: Binding(get: { on }, set: { model.toggleIr(player.playerId, on: $0) })) {
            RowLayout {
                SlotText(text: player.slot == "BN" ? "BN" : SlotLabel.of(player.slot))
            } player: {
                // PlayerLine carries ESPN's injury tag; the bench row says "Going on IR".
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    PlayerLine(player: player)
                    if moving && !on {
                        Label("Coming off IR, to the bench", systemImage: "arrow.uturn.left")
                            .typeStyle(TypeScale.label).foregroundStyle(.sky)
                            .transition(.opacity)
                    }
                }
            } points: {
                EmptyView()
            }
        }
        .tint(.sky)
        .disabled(player.locked)
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.lg)
        .background(moving ? Color.sky.opacity(0.06) : .clear)
        .accessibilityLabel(
            ([player.name, status, player.locked ? "locked" : nil, moving ? (on ? "going on IR" : "coming off IR") : nil] as [String?])
                .compactMap(\.self).joined(separator: ", "))
        .accessibilityIdentifier("ir-\(player.playerId)")
    }

    /// ESPN's designation as the web words it: "out", "injured reserve".
    private var status: String {
        player.injuryStatus == "INJURY_RESERVE" ? "Injured reserve" : player.injuryStatus.capitalized
    }
}

private struct BenchRow: View {
    let model: LineupModel
    let player: ViewPlayer
    let onTap: () -> Void

    var body: some View {
        let seat = model.staged.firstIndex(of: player.playerId)
        let toIr = model.ir.contains(player.playerId)
        Button(action: onTap) {
            RowLayout {
                SlotText(text: "BN")
            } player: {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    PlayerLine(player: player)
                    if toIr {
                        Label("Going on IR", systemImage: "cross.case")
                            .typeStyle(TypeScale.label).foregroundStyle(.sky)
                            .transition(.opacity)
                    } else if let seat {
                        Label("Starting at \(SlotLabel.of(model.seats[seat]))", systemImage: "arrow.turn.right.up")
                            .typeStyle(TypeScale.label).foregroundStyle(.sky)
                            .transition(.opacity)
                    }
                }
            } points: {
                RowPoints(player: player, locked: player.locked)
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.lg)
            .background(seat != nil || toIr ? Color.sky.opacity(0.06) : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(RowButtonStyle())
        .disabled(player.locked || toIr)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(
            ["Bench", player.name, "projected \(SeasonFormat.points(player.points))", player.locked ? "locked" : nil, toIr ? "going on IR" as String? : seat.map { "starting at \(SlotLabel.of(model.seats[$0]))" }]
                .compactMap(\.self).joined(separator: ", "))
        .accessibilityHint(player.locked || toIr ? "" : "Shows where he can start")
        .accessibilityIdentifier("bench-\(player.playerId)")
    }
}

private struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Color.hover : .clear)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

/// The save's call to action, riding above the tab bar on every tab while changes wait (APE-416),
/// and shrinking beside it when the tab bar minimizes.
struct ReviewAccessory: View {
    let model: LineupModel
    let onReview: () -> Void
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        let swaps = model.changedSeats.count
        // An IR move and the seat it frees are one change on the server, so only seats get counted.
        let count = model.irChanges > 0 ? "changes" : swaps == 1 ? "1 swap" : "\(swaps) swaps"
        Button(action: onReview) {
            HStack(spacing: Spacing.sm) {
                Text(placement == .inline ? count.prefix(1).uppercased() + count.dropFirst() : "Review \(count)")
                    .typeStyle(TypeScale.body)
                    .foregroundStyle(.text)
                Image(systemName: "arrow.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.mine)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Review \(count)")
        .accessibilityIdentifier("review-lineup")
    }
}

// MARK: - Pickers

/// Who plays a seat: a native sheet in place of the web's SeatPicker popover.
private struct SeatPicker: View {
    let model: LineupModel
    let seat: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let label = SlotLabel.of(model.seats[seat])
        let current = model.staged[seat]
        NavigationStack {
            List {
                ForEach(model.options(for: seat)) { player in
                    Button {
                        model.choose(seat, player.playerId)
                        dismiss()
                    } label: {
                        PickerOption(player: player, tags: tags(player, label: label), chosen: player.playerId == current)
                    }
                    .accessibilityIdentifier("pick-\(player.playerId)")
                }
                if current != nil {
                    Button("Leave \(label) empty") {
                        model.choose(seat, nil)
                        dismiss()
                    }
                    .foregroundStyle(.muted)
                }
            }
            .listRowBackground(Color.panel)
            .scrollContentBackground(.hidden)
            .background(.bg)
            .navigationTitle("Who plays \(label)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func tags(_ player: ViewPlayer, label: String) -> [String] {
        var tags: [String] = []
        if player.playerId == model.recommended[seat] { tags.append("Suggested") }
        if player.playerId == model.onEspn[seat] {
            tags.append("On ESPN at \(label)")
        } else if let at = model.staged.firstIndex(of: player.playerId), at != seat {
            tags.append("Starting at \(SlotLabel.of(model.seats[at]))")
        } else if model.staged.firstIndex(of: player.playerId) == nil {
            tags.append("On the bench")
        }
        return tags
    }
}

/// Where a bench player starts: the web's BenchPicker.
private struct BenchPicker: View {
    let model: LineupModel
    let player: ViewPlayer
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let at = model.staged.firstIndex(of: player.playerId)
        let seats = model.seats(for: player)
        NavigationStack {
            List {
                ForEach(seats, id: \.self) { seat in
                    let holder = model.player(model.staged[seat])
                    Button {
                        model.choose(seat, player.playerId)
                        dismiss()
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(SlotLabel.of(model.seats[seat])), \(holder.map { "over \($0.name)" } ?? "empty now")")
                                    .typeStyle(TypeScale.body).foregroundStyle(.text)
                                if model.recommended[seat] == player.playerId {
                                    Text("Suggested").typeStyle(TypeScale.micro).foregroundStyle(.valueInk)
                                }
                            }
                            Spacer()
                            if let holder { Text(SeasonFormat.points(holder.points)).typeStyle(TypeScale.title).monospacedDigit().foregroundStyle(.muted) }
                        }
                    }
                    .accessibilityIdentifier("start-at-\(seat)")
                }
                if let at {
                    Button("Keep him on the bench") {
                        model.choose(at, model.onEspn[at])
                        dismiss()
                    }
                    .foregroundStyle(.muted)
                }
                if seats.isEmpty && at == nil {
                    Text("No open slot he can play.").foregroundStyle(.muted)
                }
            }
            .listRowBackground(Color.panel)
            .scrollContentBackground(.hidden)
            .background(.bg)
            .navigationTitle("Where \(SeasonFormat.shortName(player)) starts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct PickerOption: View {
    let player: ViewPlayer
    let tags: [String]
    let chosen: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                PlayerLine(player: player)
                if !tags.isEmpty {
                    HStack(spacing: Spacing.sm) {
                        ForEach(tags, id: \.self) { tag in
                            Text(tag).typeStyle(TypeScale.micro).foregroundStyle(tag == "Suggested" ? Color.valueInk : Color.muted)
                        }
                    }
                }
            }
            Spacer(minLength: Spacing.md)
            Text(SeasonFormat.points(player.points)).typeStyle(TypeScale.title).monospacedDigit().foregroundStyle(.text)
            if chosen { Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(.sky) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}

#Preview {
    let api = APIClient(baseURL: URL(string: "http://localhost:3000")!)
    let store = SeasonStore(api: api, leagueId: "lg-1")
    LineupView(model: LineupModel(api: api, store: store), fill: FillModel(api: api, store: store), ai: AiModel(api: api, store: store), onReconnect: {})
}
