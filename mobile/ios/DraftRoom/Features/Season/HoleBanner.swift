import SwiftUI

/// A starting slot nobody on the roster can play this week, shown on every tab so the hole is never a
/// surprise (APE-418). Fill it opens the fill sheet on the first hole.
struct HoleBanner: View {
    let holes: [Hole]
    let onFill: (Hole) -> Void

    var body: some View {
        Button { if let hole = holes.first { onFill(hole) } } label: {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.warn)
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(HoleText.headline(holes))
                        .typeStyle(TypeScale.body).foregroundStyle(.text)
                    Text("Nobody on your team can play \(holes.count == 1 ? "it" : "them") this week.")
                        .typeStyle(TypeScale.label).foregroundStyle(.muted)
                }
                Spacer(minLength: Spacing.md)
                Text(holes.count == 1 ? "Fill it" : "Fill them").typeStyle(TypeScale.body).foregroundStyle(.sky)
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.sky)
            }
            .padding(Spacing.xl)
            .background(Color.warn.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.dialog))
            .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(Color.warn.opacity(0.35)))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Finds a free agent to fill it")
        .accessibilityIdentifier("hole-banner")
    }
}
