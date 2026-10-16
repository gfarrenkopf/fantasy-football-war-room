import SwiftUI

/// Every available player, below the pickups (APE-411), after the web's FreeAgentSearch: a name
/// search and a position switch over the league's pool, most-rostered first. A row's Add or Claim
/// opens the same confirm as a pickup's; the next page reads as the list reaches its end.
struct FreeAgentsCard: View {
    let model: WaiversModel
    @FocusState private var typing: Bool

    private var search: FreeAgentsModel { model.freeAgents }

    var body: some View {
        SeasonCard(title: "Free agents", note: "Most rostered first") {
            VStack(spacing: 0) {
                VStack(spacing: Spacing.md) {
                    field
                    Picker("Position", selection: Binding(get: { search.position }, set: { search.choose(position: $0) })) {
                        Text("All").tag(String?.none)
                        ForEach(FreeAgentsModel.positions, id: \.self) { Text(SlotLabel.of($0)).tag(Optional($0)) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("free-agents-position")
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.lg)

                if let reason = model.wire?.claims.reason, !model.canClaim, search.players.contains(where: { $0.player.status == "WAIVERS" }) {
                    Label(reason, systemImage: "info.circle")
                        .typeStyle(TypeScale.label).fontWeight(.regular).foregroundStyle(.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.bottom, Spacing.lg)
                }
                results
            }
        }
        .task { await search.start() }
    }

    private var field: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass").foregroundStyle(.dim).accessibilityHidden(true)
            TextField("Search by name", text: Binding(get: { search.query }, set: { search.search($0) }))
                .typeStyle(TypeScale.body)
                .foregroundStyle(.text)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($typing)
                .onSubmit { typing = false }
                .accessibilityLabel("Search available players by name")
                .accessibilityIdentifier("free-agents-search")
            if !search.query.isEmpty {
                Button { search.search("") } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.dim)
                }
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.leading, Spacing.lg)
        .frame(minHeight: 44)
        .background(.panel2, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).stroke(typing ? Color.line2 : Color.line))
    }

    @ViewBuilder private var results: some View {
        switch search.load {
        case let .failed(message):
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(message).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Try again") { Task { await search.reload() } }
                    .buttonStyle(AddButtonStyle())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.xl)
        case .loading where search.players.isEmpty:
            ProgressView().tint(.muted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.xl * 2)
                .accessibilityLabel("Reading ESPN's player pool")
        case .ready where search.players.isEmpty:
            Text(empty)
                .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.xl)
                .accessibilityIdentifier("free-agents-empty")
        default:
            LazyVStack(spacing: 0) {
                ForEach(search.players) { pickup in
                    Divider().overlay(.rowLine)
                    row(pickup)
                }
                if search.more {
                    Divider().overlay(.rowLine)
                    ProgressView().tint(.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Spacing.lg)
                        .onAppear { Task { await search.loadMore() } }
                        .accessibilityLabel("Loading more players")
                }
            }
            // The last list stays up, stepped back, while the next search reads.
            .opacity(search.load == .loading ? 0.55 : 1)
            .animation(Motion.respond, value: search.load)
        }
    }

    private func row(_ pickup: Pickup) -> some View {
        let flat = pickup.perWeek < 0.05
        return WireRow(
            model: model, player: pickup.player, drop: pickup.drop,
            gain: SeasonFormat.signed(pickup.perWeek), unit: "a week",
            detail: flat ? "Wouldn't start" : "\(SeasonFormat.signed(pickup.delta)) rest of season",
            waivers: WireRow.waiversLine(pickup.player),
            flat: flat
        ) { Task { await model.acquire(pickup) } }
    }

    /// "No available kicker matching “bas”." and what ESPN's search matches.
    private var empty: String {
        let who = search.position.map { SlotLabel.of($0) } ?? "player"
        let name = search.query.trimmingCharacters(in: .whitespaces)
        return search.searching
            ? "No available \(who) matching “\(name)”. ESPN matches the start of a first or last name."
            : "No available \(who). Every one is on a roster."
    }
}
