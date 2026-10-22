import SwiftUI

/// A trade on ESPN, after the web's TradeWrite (APE-405): the consent the first time, then the
/// server's question ("Accept on ESPN? You get … and send …"), and the send. Nothing is written until
/// the user confirms, and nothing is ever queued.
struct TradeSheet: View {
    let model: TradesModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    switch model.phase {
                    case let .consent(version, lines):
                        ConsentStep(lines: lines) { Task { await model.agree(version: version) } }
                    case let .failed(message, details):
                        FailedStep(message: message, details: details) { Task { await model.retry() } }
                    case let .review(dry):
                        Text(dry.text).typeStyle(TypeScale.title).foregroundStyle(.text)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("trade-question")
                        ForEach(dry.problems, id: \.self) { problem in
                            Label(problem, systemImage: "exclamationmark.triangle.fill")
                                .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.warnInk)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    case .checking, .sending:
                        ProgressView().tint(.muted).frame(maxWidth: .infinity)
                    case .idle:
                        EmptyView()
                    }
                }
                .padding(Spacing.xl + Spacing.xs)
                .animation(Motion.respond, value: model.phase)
            }
            .background(.bg)
            .safeAreaInset(edge: .bottom) {
                if showsSend { SendBar(model: model, verb: verb) }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.dismiss() }.disabled(model.phase == .sending)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(model.phase == .sending)
        .accessibilityIdentifier("trade-sheet")
    }

    private var showsSend: Bool {
        switch model.phase {
        case .review, .checking, .sending: true
        default: false
        }
    }

    private var verb: (idle: String, busy: String) {
        switch model.action {
        case let .respond(_, kind):
            switch kind {
            case .accept: ("Accept on ESPN", "Accepting…")
            case .decline: ("Decline on ESPN", "Declining…")
            default: ("Withdraw on ESPN", "Withdrawing…")
            }
        default: ("Offer on ESPN", "Sending the offer…")
        }
    }

    private var title: String {
        if case .consent = model.phase { return "Changes on ESPN" }
        switch model.action {
        case let .respond(offer, kind):
            switch kind {
            case .accept: return "Accept \(offer.partner.name)'s offer"
            case .decline: return "Decline \(offer.partner.name)'s offer"
            default: return "Withdraw your offer"
            }
        default:
            return "Offer a trade"
        }
    }
}

private struct SendBar: View {
    let model: TradesModel
    let verb: (idle: String, busy: String)

    var body: some View {
        let busy = model.phase == .checking || model.phase == .sending
        let ready = if case let .review(dry) = model.phase { dry.problems.isEmpty } else { false }
        Button {
            Task { await model.send() }
        } label: {
            HStack(spacing: Spacing.md) {
                if busy { ProgressView().tint(.sky) }
                Text(model.phase == .sending ? verb.busy : verb.idle)
            }
        }
        .buttonStyle(ProviderButtonStyle(prominent: true))
        .disabled(busy || !ready)
        .accessibilityIdentifier("trade-send")
        .padding(.horizontal, Spacing.xl + Spacing.xs)
        .padding(.vertical, Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
    }
}
