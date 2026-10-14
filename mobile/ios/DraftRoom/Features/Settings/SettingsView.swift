import SwiftUI

/// The account: who's signed in, signing out, and deleting the account (App Store guideline 5.1.1(v)).
struct SettingsView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var confirmingDelete = false
    @State private var typed = ""
    @State private var working = false
    @State private var errorMessage: String?
    /// nil while loading or when in-season features are off; .some(nil) when not connected.
    @State private var espn: EspnLoginStatus?
    @State private var connecting = false
    @State private var confirmingSignOut = false

    var body: some View {
        NavigationStack {
            List {
                if let user = session.me?.user {
                    Section("Signed in as") {
                        Text(user.email ?? user.name ?? "Your account")
                            .foregroundStyle(.text)
                    }
                }
                if session.me?.flags.season == true {
                    Section("ESPN connection") {
                        if let login = espn?.login {
                            LabeledContent("Status", value: login.status == "connected" ? "Connected · \(login.season)" : "Needs reconnecting")
                                .foregroundStyle(.text)
                            if login.status != "connected" {
                                Button("Reconnect ESPN") { connecting = true }
                            }
                            Button("Disconnect ESPN", role: .destructive) { Task { await disconnect() } }
                                .foregroundStyle(.softRed)
                        } else if espn != nil {
                            Button("Connect ESPN") { connecting = true }
                        } else {
                            ProgressView()
                        }
                    }
                }
                Section {
                    Button("Privacy policy") {
                        openURL(session.api.baseURL.appending(path: "privacy"))
                    }
                    .foregroundStyle(.text)
                }
                Section {
                    Button("Sign out") {
                        if session.hasUnsavedLineup { confirmingSignOut = true } else { signOut() }
                    }
                    .foregroundStyle(.text)
                    .accessibilityIdentifier("settings-signout")
                    .confirmationDialog("Your lineup changes aren't saved to ESPN", isPresented: $confirmingSignOut, titleVisibility: .visible) {
                        Button("Discard changes and sign out", role: .destructive) { signOut() }
                        Button("Keep editing", role: .cancel) {}
                    }
                }
                Section {
                    Button("Delete account", role: .destructive) {
                        typed = ""
                        confirmingDelete = true
                    }
                    .foregroundStyle(.softRed)
                    .accessibilityIdentifier("settings-delete")
                } footer: {
                    Text("Deletes your leagues, drafts, plans, ESPN connection and settings, on every device. It can't be undone.")
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.reachInk)
                }
            }
            .listRowBackground(Color.panel)
            .scrollContentBackground(.hidden)
            .background(.bg)
            .disabled(working)
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await loadEspn() }
            .sheet(isPresented: $connecting, onDismiss: { Task { await loadEspn() } }) { EspnConnectView() }
            .alert("Delete your account?", isPresented: $confirmingDelete) {
                TextField("DELETE", text: $typed)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                Button("Delete account", role: .destructive) {
                    Task { await delete() }
                }
                .disabled(typed != "DELETE")
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Everything saved to your account is deleted for good. Type DELETE to confirm.")
            }
        }
    }

    private func signOut() {
        Task {
            working = true
            await session.signOut()
            working = false
        }
    }

    private func loadEspn() async {
        guard session.me?.flags.season == true else { return }
        espn = try? await session.api.get("api/v1/espn/login")
    }

    private func disconnect() async {
        do {
            try await session.api.send("DELETE", "api/v1/espn/login")
            espn = EspnLoginStatus(login: nil)
        } catch {
            errorMessage = error.message
        }
    }

    private func delete() async {
        guard typed == "DELETE" else { return }
        working = true
        defer { working = false }
        do {
            try await session.deleteAccount()
        } catch {
            errorMessage = error.message
        }
    }
}
