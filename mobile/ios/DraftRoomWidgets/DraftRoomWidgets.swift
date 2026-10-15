import SwiftUI
import WidgetKit

/// The app's widget extension. For now it holds only the Game day Live Activity (21.5).
@main
struct DraftRoomWidgets: WidgetBundle {
    var body: some Widget {
        GameDayLiveActivity()
    }
}
