import SwiftUI
import UIKit

/// Trade ideas (APE-392), after the web's TradeIdeas: two trades a week, picked from every roster in
/// the league and written up by the AI. A win-win the partner has a reason to take, and a bolder swing.
/// The server graded each one again against the rosters now; the card shows what it sent.
struct TradeIdeasCard: View {
    let ai: AiModel
    let trades: TradesModel

    var body: some View {
        if let state = ai.ai, state.ideas != nil || state.canFindIdeas || state.access.isLocked {
            SeasonCard(title: "Trade ideas", note: note(state)) {
                VStack(alignment: .leading, spacing: 0) {
                    if let ideas = state.ideas {
                        ForEach(Array(ideas.ideas.enumerated()), id: \.element.id) { index, idea in
                            if index > 0 { Divider().overlay(.rowLine) }
                            IdeaRow(idea: idea, trades: trades)
                        }
                        ForEach(ideas.missing, id: \.self) { line in
                            Text(line).typeStyle(TypeScale.label).foregroundStyle(.dim)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.horizontal, Spacing.xl)
                                .padding(.bottom, Spacing.lg)
                        }
                    } else if state.access.isLocked {
                        AiLocked(note: state.access.note)
                            .padding(.horizontal, Spacing.xl)
                            .padding(.bottom, Spacing.xl)
                    } else {
                        find
                            .padding(.horizontal, Spacing.xl)
                            .padding(.bottom, Spacing.xl)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("trade-ideas")
            .animation(Motion.respond, value: state)
            .animation(Motion.respond, value: ai.working)
        }
    }

    private func note(_ state: AiResponse) -> String? {
        if state.ideas != nil { return "Week \(state.week)" }
        return state.access.state == "trial" ? state.access.note : nil
    }

    /// Before this week's ideas are found: what they are, and "Find trades".
    @ViewBuilder private var find: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            if ai.working == .ideas {
                AiWriting(title: "Checking every roster, then writing them up…")
            } else {
                Text(ai.ideasNone
                    ? "No trade clears the bar this week: none gains you points without costing the other team more than half a point a week. Rosters change after waivers, and searching again is free."
                    : "Two trades a week, picked from every roster in the league: a win-win, and a bolder swing.")
                    .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Button(ai.ideasNone ? "Search again" : "Find trades") { Task { await ai.findIdeas() } }
                    .buttonStyle(ProviderButtonStyle(prominent: !ai.ideasNone))
                    .accessibilityIdentifier("find-trade-ideas")
            }
            if let error = ai.ideasError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .typeStyle(TypeScale.label).foregroundStyle(.warnInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// One idea (the web's IdeaCard): who, both sides, the grade now, why, and a note to send the partner.
private struct IdeaRow: View {
    let idea: AiIdea
    let trades: TradesModel
    @State private var copied = false

    private var active: Bool { trades.loadedIdea == idea.kind }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                AiTag(text: idea.label, tone: idea.kind == "safe" ? .valueInk : .gold)
                Text(idea.partner.name).typeStyle(TypeScale.body).fontWeight(.semibold).foregroundStyle(.text)
            }
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: Spacing.md, verticalSpacing: Spacing.xs) {
                GridRow {
                    Text("You get").typeStyle(TypeScale.label).foregroundStyle(.muted)
                    Text(idea.gets.map(\.name).joined(separator: ", ")).typeStyle(TypeScale.body).foregroundStyle(.text)
                }
                GridRow {
                    Text("You send").typeStyle(TypeScale.label).foregroundStyle(.muted)
                    Text(idea.gives.map(\.name).joined(separator: ", ")).typeStyle(TypeScale.body).foregroundStyle(.text)
                }
            }
            if active {
                // Open in the builder, which grades it; a second grade here would only repeat it.
                Text("Graded in the builder. Change either side to make it your own.")
                    .typeStyle(TypeScale.label).foregroundStyle(.sky)
            } else if let grade = idea.grade, !idea.isStale {
                GradeLine(grade: grade, partner: idea.partner.name)
                if let moved = idea.moved {
                    Text(moved).typeStyle(TypeScale.label).foregroundStyle(.dim)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let note = idea.note, idea.isOffered {
                // Offered: say so where the user offered it, as good news (APE-445).
                Label(note, systemImage: "clock.badge.checkmark")
                    .typeStyle(TypeScale.label).fontWeight(.semibold).foregroundStyle(.valueInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("idea-offered-\(idea.kind)")
            } else if let note = idea.note {
                Text(note).typeStyle(TypeScale.label).fontWeight(.regular).foregroundStyle(idea.isStale ? Color.dim : Color.warnInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(idea.why).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.text)
                .fixedSize(horizontal: false, vertical: true)
            if !idea.pitch.isEmpty {
                pitch
            }
            if !idea.isStale, !active || idea.canOffer {
                HStack(spacing: Spacing.md) {
                    if !active {
                        Button("Load into builder") {
                            Task { await trades.load(partner: idea.partner.id, gives: idea.gives.map(\.id), gets: idea.gets.map(\.id), idea: idea.kind) }
                        }
                        .buttonStyle(ProviderButtonStyle())
                        .accessibilityIdentifier("load-idea-\(idea.kind)")
                    }
                    if idea.canOffer {
                        Button("Offer on ESPN") { Task { await trades.offer(idea) } }
                            .buttonStyle(ProviderButtonStyle(prominent: true))
                            .accessibilityIdentifier("offer-idea-\(idea.kind)")
                    }
                }
            }
        }
        .padding(Spacing.xl)
        .opacity(idea.isStale ? 0.6 : 1)
        .background(active ? Color.skyLine.opacity(0.12) : .clear)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("idea-\(idea.kind)")
    }

    /// The note the user could send the partner. ESPN's offer has no message field, so it's copied.
    private var pitch: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                Text("Note to \(idea.partner.name)").typeStyle(TypeScale.label).foregroundStyle(.muted)
                Spacer(minLength: Spacing.md)
                if !idea.isStale {
                    Button {
                        UIPasteboard.general.string = idea.pitch
                        copied = true
                        Task {
                            try? await Task.sleep(for: .seconds(2))
                            copied = false
                        }
                    } label: {
                        Label(copied ? "Copied" : "Copy note", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .contentTransition(.symbolEffect(.replace))
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .typeStyle(TypeScale.label).foregroundStyle(copied ? Color.valueInk : Color.sky)
                    .animation(Motion.press, value: copied)
                    .sensoryFeedback(Haptic.success, trigger: copied) { _, now in now }
                }
            }
            Text(idea.pitch).typeStyle(TypeScale.body).fontWeight(.regular).italic().foregroundStyle(.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.bg.opacity(0.35), in: RoundedRectangle(cornerRadius: Radius.lg))
    }
}

/// The AI write-up of the builder's trade (the web's AiTradeWriteupCard). Keyed by the trade, so
/// changing it starts over; asking again for the same trade this week costs nothing.
struct TradeWriteupSection: View {
    let ai: AiModel
    let trades: TradesModel

    var body: some View {
        if let state = ai.ai, let trade = trades.aiTrade {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                if state.access.isLocked {
                    AiLocked(note: state.access.note)
                } else if let writeup = ai.writeup(for: trade) {
                    Written(writeup: writeup, trade: trade, trades: trades)
                } else if ai.writingUp == trade {
                    AiWriting(title: "Writing it up…")
                } else {
                    Button("AI write-up of this trade") { Task { await ai.writeUp(trade) } }
                        .buttonStyle(ProviderButtonStyle())
                        .disabled(ai.writingUp != nil)
                        .accessibilityIdentifier("trade-writeup")
                    if state.access.state == "trial", let note = state.access.note {
                        Text(note).typeStyle(TypeScale.label).foregroundStyle(.muted)
                    }
                    if let error = ai.writeupError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .typeStyle(TypeScale.label).foregroundStyle(.warnInk)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .animation(Motion.respond, value: ai.writeup(for: trade))
            .onChange(of: trade) { ai.forgetWriteupError() }
        }
    }
}

/// A write-up: the lean, why, and any counter-offer to check in the builder; shareable.
private struct Written: View {
    let writeup: AiWriteup
    let trade: AiTradeRequest
    let trades: TradesModel

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .center, spacing: Spacing.md) {
                AiTag(text: writeup.leanLabel, tone: tone)
                Spacer(minLength: Spacing.md)
                ShareLink(item: shareText) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .typeStyle(TypeScale.label).foregroundStyle(.sky)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityIdentifier("share-writeup")
            }
            Text(writeup.summary).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.text)
                .fixedSize(horizontal: false, vertical: true)
                .riseIn(order: 0)
            ForEach(Array(writeup.reasons.enumerated()), id: \.offset) { index, reason in
                HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                    Text("•").foregroundStyle(.dim).accessibilityHidden(true)
                    Text(reason).typeStyle(TypeScale.label).foregroundStyle(.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .riseIn(order: index + 1)
            }
            if let counter = writeup.counter {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text("\(Text("Counter: ").fontWeight(.semibold))\(counter.text)")
                        .typeStyle(TypeScale.label).foregroundStyle(.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Check this counter") {
                        Task { await trades.load(partner: trade.partner, gives: counter.give.map(\.id), gets: counter.get.map(\.id)) }
                    }
                    .buttonStyle(ProviderButtonStyle())
                    .accessibilityIdentifier("check-counter")
                }
                .padding(Spacing.lg)
                .background(Color.bg.opacity(0.35), in: RoundedRectangle(cornerRadius: Radius.lg))
                .riseIn(order: writeup.reasons.count + 1)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("writeup")
    }

    private var tone: Color {
        switch writeup.lean {
        case "accept": .valueInk
        case "decline": .reachInk
        default: .warnInk
        }
    }

    /// The write-up as text a league-mate can read: the trade, the lean, and why.
    private var shareText: String {
        let partner = trades.others.first { $0.id == trade.partner }?.name ?? "them"
        var lines = ["Trade with \(partner): I send \(trades.names(trade.gives)), I get \(trades.names(trade.gets)).", "", "\(writeup.leanLabel). \(writeup.summary)"]
        lines += writeup.reasons.map { "• \($0)" }
        if let counter = writeup.counter { lines += ["", "Counter: \(counter.text)"] }
        lines += ["", "From Draft Room's AI"]
        return lines.joined(separator: "\n")
    }
}
