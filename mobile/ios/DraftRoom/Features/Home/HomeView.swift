import SwiftUI

/// Placeholder first screen. Replaced by the app shell (17.10).
struct HomeView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("Draft Room")
                .font(.largeTitle.bold())
            Text("Fantasy Football Manager")
                .foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("home")
    }
}

#Preview {
    HomeView()
}
