import SwiftUI

/// Placeholder signed-in screen. Replaced by the app shell (17.10).
struct HomeView: View {
    @Environment(Session.self) private var session
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                Text("Draft Room")
                    .typeStyle(TypeScale.headline)
                Text(session.me?.user.email ?? "")
                    .foregroundStyle(.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.bg)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Account", systemImage: "person.crop.circle") { showingSettings = true }
                        .accessibilityIdentifier("open-settings")
                }
            }
            .sheet(isPresented: $showingSettings) { SettingsView() }
        }
        .accessibilityIdentifier("home")
    }
}
