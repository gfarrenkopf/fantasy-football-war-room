import SwiftUI

/// A tab's sections, for the jump menu top left (APE-416). Each card marked `jumpSection(_:)` reports
/// where it sits; `sectionJump()` on the tab's scroll view lists them top to bottom, ticks the one
/// being read, and scrolls to the one picked. Cards come and go with the week, so the list does too.
@MainActor
@Observable
final class SectionIndex {
    /// The sections on screen, top to bottom.
    private(set) var titles: [String] = []
    /// The section being read: the last one whose top has reached the toolbar.
    private(set) var current: String?

    @ObservationIgnored private var tops: [String: CGFloat] = [:]
    /// Where the content meets the toolbar, in the scroll view's space.
    @ObservationIgnored private var edge: CGFloat = 0
    @ObservationIgnored private var atBottom = false

    /// How far below the toolbar a card's top still counts as read: past the gap a jump leaves.
    private static let reach = Spacing.xl * 3

    /// The scroll id a section's jump lands on, just above the card.
    static func anchor(_ title: String) -> String { "jump-\(title)" }

    func report(_ title: String, top: CGFloat?) {
        tops[title] = top
        update()
    }

    func scrolled(edge: CGFloat, atBottom: Bool) {
        self.edge = edge
        self.atBottom = atBottom
        update()
    }

    private func update() {
        let ordered = tops.sorted { $0.value < $1.value }.map(\.key)
        if ordered != titles { titles = ordered }
        // At the bottom the last cards can't rise to the toolbar, so the last one counts as read.
        let reading = atBottom ? ordered.last : ordered.last { tops[$0, default: 0] <= edge + Self.reach } ?? ordered.first
        if reading != current { current = reading }
    }
}

extension View {
    /// Lists the scroll view's `jumpSection`s in a menu top left, when there's more than one.
    func sectionJump() -> some View {
        modifier(SectionJump())
    }

    /// Marks a card as a section the tab's jump menu can scroll to, under its own title.
    func jumpSection(_ title: String) -> some View {
        modifier(JumpSection(title: title))
    }
}

private struct SectionJump: ViewModifier {
    @State private var index = SectionIndex()
    @State private var jumps = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        ScrollViewReader { scroll in
            content
                .environment(index)
                .onScrollGeometryChange(for: ScrollEdge.self) { geometry in
                    let top = geometry.contentInsets.top
                    let end = geometry.contentSize.height + geometry.contentInsets.bottom - geometry.containerSize.height
                    let moved = geometry.contentOffset.y > -top + 1
                    return ScrollEdge(top: top, atBottom: moved && geometry.contentOffset.y >= end - 1)
                } action: { _, edge in
                    index.scrolled(edge: edge.top, atBottom: edge.atBottom)
                }
                .toolbar {
                    if index.titles.count > 1 {
                        ToolbarItem(placement: .topBarLeading) {
                            SectionMenu(index: index) { title in
                                withAnimation(reduceMotion ? nil : Motion.settle) {
                                    scroll.scrollTo(SectionIndex.anchor(title), anchor: .top)
                                }
                                jumps += 1
                            }
                        }
                    }
                }
                .sensoryFeedback(Haptic.choice, trigger: jumps)
        }
    }
}

/// The tab's sections in the toolbar's menu, the one being read ticked.
private struct SectionMenu: View {
    let index: SectionIndex
    let onPick: (String) -> Void

    var body: some View {
        // An inline picker, so the tick sits in the menu's own gutter and every row lines up.
        Menu {
            Picker("Sections", selection: Binding(get: { index.current ?? "" }, set: onPick)) {
                ForEach(index.titles, id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.inline)
            .labelsHidden()
        } label: {
            Image(systemName: "list.bullet").foregroundStyle(.text)
        }
        .accessibilityLabel("Sections")
        .accessibilityIdentifier("section-menu")
    }
}

private struct ScrollEdge: Equatable {
    let top: CGFloat
    let atBottom: Bool
}

private struct JumpSection: ViewModifier {
    let title: String
    @Environment(SectionIndex.self) private var index: SectionIndex?
    /// Where the card last sat. Leaving the tab withdraws it, and coming back doesn't move it, so
    /// geometry reports nothing new: it's handed back on appear, or the menu stays away until a scroll.
    @State private var top: CGFloat?

    func body(content: Content) -> some View {
        content
            // The jump lands on a strip just above the card, so the card settles a gap below the toolbar.
            .overlay(alignment: .top) {
                Color.clear
                    .frame(height: Spacing.lg)
                    .alignmentGuide(.top) { $0[.bottom] }
                    .id(SectionIndex.anchor(title))
                    .accessibilityHidden(true)
            }
            .onGeometryChange(for: CGFloat?.self) { proxy in
                proxy.size.height > 0 ? proxy.frame(in: .scrollView).minY : nil
            } action: { top in
                self.top = top
                index?.report(title, top: top)
            }
            .onChange(of: title) { old, _ in index?.report(old, top: nil) }
            .onAppear { if let top { index?.report(title, top: top) } }
            .onDisappear { index?.report(title, top: nil) }
    }
}
