import SwiftUI

/// The season's sections, as tabs. Epic 19 adds Team, and Epic 20 adds AI where the web shows it.
enum SeasonTab: String, CaseIterable, Identifiable, Hashable {
    case gameDay = "gameday"
    case lineup
    case recaps

    var id: String { rawValue }

    var title: String {
        switch self {
        case .gameDay: "Game day"
        case .lineup: "Lineup"
        case .recaps: "Recaps"
        }
    }

    var symbol: String {
        switch self {
        case .gameDay: "sportscourt"
        case .lineup: "list.bullet.rectangle"
        case .recaps: "doc.text"
        }
    }
}

/// Placeholder for a section until its Epic 18 ticket builds it.
struct SeasonSectionView: View {
    let section: SeasonTab
    let league: League

    var body: some View {
        ContentUnavailableView {
            Label(section.title, systemImage: section.symbol)
        } description: {
            Text("\(league.name) · \(String(league.season))")
        }
        .foregroundStyle(.muted)
        .accessibilityIdentifier("section-\(section.rawValue)")
    }
}
