import SwiftUI

// MARK: - Pulsing Live Dot
//
// SHARED FILE — add to BOTH the app target and the MLRWidget extension target.
// Used by the live indicator (Family Fest spotlight/status) AND the widget
// extension (countdown widget + Live Activity), so it must be visible to both.

struct PulsingLiveDot: View {
    var color: Color = .mlrSuccess
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
            .overlay(
                Circle()
                    .stroke(color, lineWidth: 2)
                    .scaleEffect(pulse ? 2.2 : 1)
                    .opacity(pulse ? 0 : 0.8)
            )
            .onAppear {
                guard !UIAccessibility.isReduceMotionEnabled else { return }
                withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) {
                    pulse = true
                }
            }
            .accessibilityHidden(true)
    }
}
