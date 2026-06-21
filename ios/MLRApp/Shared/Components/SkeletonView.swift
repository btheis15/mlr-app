import SwiftUI

// MARK: - Skeleton pulse animation
// Mirrors web app's components/Skeleton.tsx pulsing placeholder pattern.
// All skeleton shapes share a single opacity animation driven from a parent
// `SkeletonContainer`, or use the `.skeletonPulse()` modifier individually.

// MARK: - Pulse modifier

/// Applies the repeating opacity pulse to any skeleton shape.
private struct SkeletonPulseModifier: ViewModifier {
    @State private var pulsed = false

    func body(content: Content) -> some View {
        content
            .opacity(pulsed ? 0.8 : 0.4)
            .onAppear {
                guard !UIAccessibility.isReduceMotionEnabled else { return }
                withAnimation(
                    .easeInOut(duration: 0.9)
                    .repeatForever(autoreverses: true)
                ) {
                    pulsed = true
                }
            }
    }
}

extension View {
    /// Applies the MLR skeleton loading pulse. Use on any gray placeholder shape.
    func skeletonPulse() -> some View {
        modifier(SkeletonPulseModifier())
    }
}

// MARK: - Base shape

/// A rounded-rectangle placeholder block. Corner radius defaults to half the
/// height (capsule) for text lines, or a fixed 12pt for card shapes.
struct SkeletonShape: View {
    var width: CGFloat? = nil  // nil → fills available width
    var height: CGFloat = 14
    var cornerRadius: CGFloat? = nil  // nil → capsule (height/2)

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius ?? (height / 2))
            .fill(Color.mlrCard)
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
            .skeletonPulse()
    }
}

// MARK: - SkeletonRow

/// A single row placeholder: avatar circle + two text lines (title + subtitle).
/// Mirrors the standard member list row layout.
struct SkeletonRow: View {
    var body: some View {
        HStack(spacing: 12) {
            // Avatar placeholder
            Circle()
                .fill(Color.mlrCard)
                .frame(width: 44, height: 44)
                .skeletonPulse()

            VStack(alignment: .leading, spacing: 7) {
                // Title line — roughly 55% width
                SkeletonShape(height: 14)
                    .frame(maxWidth: .infinity)
                    .padding(.trailing, 80)

                // Subtitle line — roughly 40% width
                SkeletonShape(height: 11)
                    .frame(maxWidth: .infinity)
                    .padding(.trailing, 140)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

// MARK: - SkeletonCard

/// A card-shaped rectangle placeholder (e.g. event card, announcement card).
struct SkeletonCard: View {
    var height: CGFloat = 100

    var body: some View {
        RoundedRectangle(cornerRadius: 16)
            .fill(Color.mlrCard)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .skeletonPulse()
            .padding(.horizontal, 16)
    }
}

// MARK: - SkeletonList

/// A vertical stack of `count` `SkeletonRow` items, separated by dividers.
/// Drop this in wherever an async list is loading.
///
///     if isLoading {
///         SkeletonList(count: 5)
///     }
struct SkeletonList: View {
    var count: Int = 4

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { index in
                SkeletonRow()
                if index < count - 1 {
                    Divider()
                        .padding(.leading, 72) // aligns with text, past avatar
                }
            }
        }
        .background(Color.mlrSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, 16)
    }
}

// MARK: - Preview

#if DEBUG
struct SkeletonView_Previews: PreviewProvider {
    static var previews: some View {
        ScrollView {
            VStack(spacing: 24) {
                SkeletonCard(height: 120)
                SkeletonList(count: 5)
                SkeletonCard(height: 80)
            }
            .padding(.vertical, 24)
        }
        .background(Color(.systemGroupedBackground))
        .previewDisplayName("Skeleton variants")
    }
}
#endif
