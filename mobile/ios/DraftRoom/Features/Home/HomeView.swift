import SwiftUI

/// Placeholder signed-in screen. Replaced by the app shell (17.10).
struct HomeView: View {
    @Environment(Session.self) private var session
    @State private var showingSettings = false
    @State private var connecting = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                Text("Draft Room")
                    .typeStyle(TypeScale.headline)
                Text(session.me?.user.email ?? "")
                    .foregroundStyle(.muted)
                Button("Connect a league") { connecting = true }
                    .buttonStyle(ProviderButtonStyle(prominent: true))
                    .frame(maxWidth: 260)
                    .padding(.top, Spacing.xl)
                    .accessibilityIdentifier("connect-league")
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
            .sheet(isPresented: $connecting) { EspnConnectView() }
        }
        .accessibilityIdentifier("home")
    }
}
