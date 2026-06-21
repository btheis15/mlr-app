import SwiftUI

// MARK: - Liquid Glass (iOS 26)
//
// iOS 26 introduces the Liquid Glass design language. SwiftUI exposes it via:
//   • `.glassEffect(_:in:)`           — apply glass to any view
//   • `Glass` config: `.regular`, `.clear`, `.tint(_:)`, `.interactive()`
//   • `GlassEffectContainer(spacing:)` — group glass shapes so they blend/morph
//   • `.glassEffectID(_:in:)`          — morphing transitions between glass shapes
//   • `.buttonStyle(.glass)` / `.glassProminent` — system glass buttons
//
// TabView, toolbars, sheets, and navigation bars adopt Liquid Glass automatically
// on iOS 26 — we don't restyle those. These helpers are for our own custom
// surfaces (CTAs, cards, floating buttons) so they match the system material.
//
// The whole app targets iOS 26, so these are used unconditionally. Where a view
// could conceivably run on an older OS in a preview, the `MLRGlass` helpers fall
// back to a tinted material via the `#available` checks below.

// MARK: - Brand glass button styles

/// Primary call-to-action rendered as prominent Liquid Glass tinted forest green.
/// Replaces the old solid-fill `.primaryButton()` on iOS 26.
struct GlassPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .glassEffect(.regular.tint(.mlrPrimary).interactive(), in: .rect(cornerRadius: 14))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Secondary action — neutral regular glass with green label.
struct GlassSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Color.mlrPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 14))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Family Fest accent — heraldic-wine tinted glass for fest CTAs.
struct GlassFestButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .glassEffect(.regular.tint(.mlrFest).interactive(), in: .rect(cornerRadius: 14))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Compact circular glass button — for floating actions (new post, ask for help).
struct GlassCircleButtonStyle: ButtonStyle {
    var tint: Color = .mlrPrimary
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 56, height: 56)
            .glassEffect(.regular.tint(tint).interactive(), in: .circle)
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == GlassPrimaryButtonStyle {
    static var glassPrimary: GlassPrimaryButtonStyle { .init() }
}
extension ButtonStyle where Self == GlassSecondaryButtonStyle {
    static var glassSecondary: GlassSecondaryButtonStyle { .init() }
}
extension ButtonStyle where Self == GlassFestButtonStyle {
    static var glassFest: GlassFestButtonStyle { .init() }
}
extension ButtonStyle where Self == GlassCircleButtonStyle {
    static func glassCircle(tint: Color = .mlrPrimary) -> GlassCircleButtonStyle { .init(tint: tint) }
}

// MARK: - Glass card surface

extension View {
    /// Wraps content in a Liquid Glass card. Use for floating cards that sit over
    /// imagery or scrolling content (spotlight, callouts). For plain inset list
    /// cards keep `.cardStyle()` (opaque) — glass is for layered surfaces.
    func glassCard(cornerRadius: CGFloat = 18, tint: Color? = nil) -> some View {
        let glass: Glass = tint.map { .regular.tint($0) } ?? .regular
        return self.glassEffect(glass, in: .rect(cornerRadius: cornerRadius))
    }
}

// NOTE: `PulsingLiveDot` lives in `ios/Shared/PulsingLiveDot.swift` so it can be
// shared with the widget extension target (Live Activity + countdown widget).
