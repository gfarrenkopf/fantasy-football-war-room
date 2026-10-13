import SwiftUI

/// Shown when the server needs a newer app than this one (`minAppVersion` from /api/v1/me).
struct UpdateRequiredView: View {
    var body: some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: "arrow.down.app")
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(.sky)
            Text("Time to update")
                .typeStyle(TypeScale.title)
                .foregroundStyle(.text)
            Text("This version of Draft Room is too old for the server. Update the app to carry on.")
                .typeStyle(TypeScale.body)
                .fontWeight(.regular)
                .foregroundStyle(.muted)
                .multilineTextAlignment(.center)
        }
        .padding(Spacing.xl * 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.bg)
    }
}
