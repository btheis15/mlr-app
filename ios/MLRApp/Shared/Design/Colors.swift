import SwiftUI
import UIKit

// MARK: - MLR Color Tokens (adaptive light + dark)
//
// The app supports BOTH light and dark mode. Every brand token below is an
// ADAPTIVE color: it resolves to a light value in light mode and a dark value in
// dark mode via a UIColor dynamic provider. Surface/text tokens use Apple's
// semantic system colors, which already adapt.
//
// ⚠️ Transparency rule (read before adding any translucent surface):
//   • For a *surface/card background*, prefer an opaque adaptive token
//     (`mlrCard`, `mlrSurface`) or a `Material` — NOT a translucent solid color.
//     A solid color at low opacity goes muddy grey on light AND washed-out on
//     dark. The brand "tint card" fills (e.g. `mlrFest.opacity(0.1)`) are only OK
//     because they sit over an adaptive surface and the tint token itself adapts.
//   • `Color.black.opacity(...)` is allowed ONLY as a modal scrim / lightbox bg.
//   • Never put a translucent layer over a hardcoded `Color.white` — use
//     `mlrSurface` so the backdrop is correct in dark mode.
//   • Liquid Glass (`.glassEffect`) must sit over real content/an adaptive
//     surface, never over literal white, or it can't read the backdrop.

extension Color {
    // Primary brand — forest green (the logo)
    static let mlrPrimary      = Color(light: "#15503a", dark: "#46A578")
    static let mlrPrimaryDark  = Color(light: "#0f3d2b", dark: "#2E7D5B")
    /// Pale fill used behind secondary buttons / tint chips. Dim green in dark.
    static let mlrPrimaryLight = Color(light: "#e8f2ec", dark: "#16352A")

    // Accent — vintage chestnut
    static let mlrAccent       = Color(light: "#804020", dark: "#C98A5E")

    // Family Fest heraldic wine + parchment (the FF section's identity).
    // Parchment becomes a dark warm brown in dark mode so the section still reads
    // as a distinct "Renaissance" world rather than the resort's pure-black canvas.
    static let mlrFest          = Color(light: "#801c32", dark: "#D85A77")
    static let mlrFestLight     = Color(light: "#fdf6f0", dark: "#2A211C")
    static let mlrFestParchment = Color(light: "#f5ede0", dark: "#221B15")

    // Surfaces — semantic, auto-adapting
    static let mlrSurface      = Color(.systemBackground)
    static let mlrCard         = Color(.secondarySystemBackground)
    static let mlrGroupedCard  = Color(.tertiarySystemBackground)
    static let mlrBorder       = Color(.separator)

    // Text — semantic, auto-adapting
    static let mlrText         = Color(.label)
    static let mlrTextMuted    = Color(.secondaryLabel)
    static let mlrTextSubtle   = Color(.tertiaryLabel)

    // Status — brightened in dark for contrast on black
    static let mlrSuccess      = Color(light: "#16a34a", dark: "#34D17F")
    static let mlrWarning      = Color(light: "#d97706", dark: "#F59E42")
    static let mlrDanger       = Color(light: "#dc2626", dark: "#F26B6B")
    static let mlrInfo         = Color(light: "#2563eb", dark: "#5B9BFF")
}

// MARK: - Initializers

extension Color {
    /// Solid hex color (used for the per-mode values below).
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

    /// Adaptive color resolving per the active interface style.
    init(light: String, dark: String) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(Color(hex: dark))
                : UIColor(Color(hex: light))
        })
    }
}

// MARK: - Semantic view modifiers
//
// Prefer the Liquid Glass button styles in LiquidGlass.swift for prominent CTAs.
// These solid-fill helpers remain for non-glass contexts; both adapt to dark mode
// because the tokens adapt.

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

    /// Opaque adaptive card. Use this for card backgrounds rather than a
    /// translucent solid color (see the transparency rule above).
    func cardStyle() -> some View {
        self
            .background(Color.mlrCard)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
