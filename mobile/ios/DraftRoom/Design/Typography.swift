import SwiftUI

// Maps the web's type scale (TypeScale in Tokens.swift, generated) onto the iPhone.
//
// The web sets its root font size to 13px, while iOS reads body text at 17pt, so every web size
// is scaled by 17/13 to keep the same proportions at phone reading distance: body 12.5px becomes
// about 16pt, micro 10.5px about 14pt. Sizes then follow the user's Dynamic Type setting.
//
// The web's font stack is the platform's system font, so iOS uses San Francisco and bundles no
// font files.

enum Typography {
    static let phoneScale: CGFloat = 17.0 / 13.0

    /// The Dynamic Type style a token scales with, picked by its size on the phone.
    static func textStyle(for token: TypeToken) -> Font.TextStyle {
        switch token.size * phoneScale {
        case ..<14: .caption
        case ..<15.5: .footnote
        case ..<17.5: .body
        case ..<22: .title3
        case ..<30: .title2
        default: .largeTitle
        }
    }
}

private struct TypeStyle: ViewModifier {
    let token: TypeToken
    @ScaledMetric private var size: CGFloat

    init(_ token: TypeToken, dense: Bool = false) {
        self.token = token
        _size = ScaledMetric(wrappedValue: token.size * (dense ? 1 : Typography.phoneScale), relativeTo: Typography.textStyle(for: token))
    }

    func body(content: Content) -> some View {
        content
            .font(.system(size: size, weight: token.weight))
            .tracking(token.tracking * size / token.size)
            // SwiftUI's own leading is about 1.2; only looser web line heights add space.
            .lineSpacing(max(0, size * (token.lineHeight - 1.2)))
    }
}

extension View {
    /// Sets the font, tracking and line spacing of a web type role: `.typeStyle(TypeScale.body)`.
    ///
    /// `dense` keeps the web's px as points, for a column as packed as the web's phone layout (the
    /// head-to-head, APE-423); it still follows Dynamic Type.
    func typeStyle(_ token: TypeToken, dense: Bool = false) -> some View {
        modifier(TypeStyle(token, dense: dense))
    }
}
