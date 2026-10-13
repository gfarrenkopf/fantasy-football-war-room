#if DEBUG
import SwiftUI

/// A preview-only sheet of the generated tokens, to compare against the web.
struct TokenSwatches: View {
    private let colors: [(String, Color)] = [
        ("bg", .bg), ("panel", .panel), ("panel2", .panel2), ("line", .line), ("line2", .line2),
        ("text", .text), ("muted", .muted), ("dim", .dim),
        ("qb", .qb), ("rb", .rb), ("wr", .wr), ("te", .te), ("k", .k), ("dst", .dst),
        ("value", .value), ("reach", .reach), ("warn", .warn), ("mine", .mine), ("focus", .focus),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: Spacing.md)], spacing: Spacing.md) {
                    ForEach(colors, id: \.0) { name, color in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            RoundedRectangle(cornerRadius: Radius.card)
                                .fill(color)
                                .frame(height: 44)
                                .overlay(RoundedRectangle(cornerRadius: Radius.card).stroke(.line))
                            Text(name).typeStyle(TypeScale.label).foregroundStyle(.muted)
                        }
                    }
                }
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text("82%").typeStyle(TypeScale.odds)
                    Text("Headline").typeStyle(TypeScale.headline)
                    Text("Title").typeStyle(TypeScale.title)
                    Text("Body text for a player row").typeStyle(TypeScale.body)
                    Text("Label").typeStyle(TypeScale.label).foregroundStyle(.muted)
                    Text("MICRO").typeStyle(TypeScale.micro).foregroundStyle(.dim)
                }
                .foregroundStyle(.text)
            }
            .padding(Spacing.xl)
        }
        .background(.bg)
    }
}

#Preview {
    TokenSwatches()
}
#endif
