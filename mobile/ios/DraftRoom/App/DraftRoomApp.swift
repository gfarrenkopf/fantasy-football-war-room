import SwiftUI

@main
struct DraftRoomApp: App {
    @State private var environment = AppEnvironment.current

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environment(environment)
                .preferredColorScheme(.dark)
        }
    }
}
