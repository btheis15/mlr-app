import SwiftUI

// MARK: - MLR Color Tokens
// Mirrors CSS custom properties in app/globals.css.
// Never use hex literals in views — add a token here instead.

extension Color {
    // Primary brand
    static let mlrPrimary     = Color(hex: "#15503a") // forest green (logo)
    static let mlrPrimaryDark = Color(hex: "#0f3d2b")
    static let mlrPrimaryLight = Color(hex: "#e8f2ec")

    // Accent
    static let mlrAccent      = Color(hex: "#804020") // vintage chestnut

    // Family Fest heraldic wine — for fest accents outside .ff-section
    static let mlrFest        = Color(hex: "#801c32")
    static let mlrFestLight   = Color(hex: "#fdf6f0")
    static let mlrFestParchment = Color(hex: "#f5ede0")

    // Surfaces
    static let mlrSurface     = Color(.systemBackground)
    static let mlrCard        = Color(.secondarySystemBackground)
    static let mlrBorder      = Color(.separator)

    // Text
    static let mlrText        = Color(.label)
    static let mlrTextMuted   = Color(.secondaryLabel)
    static let mlrTextSubtle  = Color(.tertiaryLabel)

    // Status
    static let mlrSuccess     = Color(hex: "#16a34a")
    static let mlrWarning     = Color(hex: "#d97706")
    static let mlrDanger      = Color(hex: "#dc2626")
    static let mlrInfo        = Color(hex: "#2563eb")
}

// MARK: - Hex initializer

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: Double
        switch hex.count {
        case 6:
            r = Double((int >> 16) & 0xFF) / 255
            g = Double((int >> 8)  & 0xFF) / 255
            b = Double(int         & 0xFF) / 255
        default:
            r = 1; g = 1; b = 1
        }
        self.init(red: r, green: g, blue: b)
    }
}

// MARK: - Semantic view modifiers

extension View {
    func primaryButton() -> some View {
        self
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Color.mlrPrimary)
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    func secondaryButton() -> some View {
        self
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Color.mlrPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Color.mlrPrimaryLight)
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    func cardStyle() -> some View {
        self
            .background(Color.mlrCard)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
