import SwiftUI
import UserNotifications

/// Settings → Notifications (21.3): one row per season alert, with how it reaches you.
struct NotificationsView: View {
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: NotificationsModel?
    @State private var system: UNAuthorizationStatus?

    var body: some View {
        List {
            switch model?.load {
            case nil, .loading:
                ProgressView().frame(maxWidth: .infinity)
            case let .failed(message):
                Text(message).foregroundStyle(.muted)
            case .ready:
                if let model, let settings = model.settings {
                    if model.wantsPush, let system { permissionSection(system) }
                    Section {
                        ForEach(settings.alerts) { alert in
                            AlertRow(alert: alert, choices: settings.choices(for: alert)) { channel in
                                Task { await model.choose(channel, for: alert.kind) }
                            }
                        }
                    } footer: {
                        if let error = model.errorMessage {
                            Text(error).foregroundStyle(.reachInk)
                        } else if !settings.email {
                            Text("Email alerts aren't available for this account.")
                        }
                    }
                }
            }
        }
        .listRowBackground(Color.panel)
        .scrollContentBackground(.hidden)
        .background(.bg)
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard model == nil else { return }
            let model = NotificationsModel(api: session.api)
            self.model = model
            async let load: Void = model.start()
            system = await session.push.authorizationStatus()
            await load
        }
        // Back from iOS Settings: notifications may have just been turned on.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { system = await session.push.authorizationStatus() } }
        }
    }

    @ViewBuilder
    private func permissionSection(_ status: UNAuthorizationStatus) -> some View {
        switch status {
        case .notDetermined:
            Section {
                Button("Turn on notifications") {
                    Task {
                        await session.push.askOnce()
                        system = await session.push.authorizationStatus()
                    }
                }
            } footer: {
                Text("iPhone alerts need your OK first.")
            }
        case .denied:
            Section {
                Button("Open iPhone Settings") {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                }
            } footer: {
                Text("Notifications are off for Draft Room, so iPhone alerts can't reach you. Turn them on in Settings.")
            }
        default:
            EmptyView()
        }
    }
}

private struct AlertRow: View {
    let alert: NotificationSettings.Alert
    let choices: [AlertChannel]
    let choose: (AlertChannel) -> Void

    var body: some View {
        Picker(selection: Binding(get: { alert.channel }, set: choose)) {
            ForEach(choices, id: \.self) { Text($0.label).tag($0) }
        } label: {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(alert.title).foregroundStyle(.text)
                Text(alert.detail).typeStyle(TypeScale.label).foregroundStyle(.muted)
            }
        }
        .pickerStyle(.menu)
        .accessibilityIdentifier("alert-\(alert.kind)")
    }
}
