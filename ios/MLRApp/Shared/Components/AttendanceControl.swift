import SwiftUI

// MARK: - AttendanceControl
// Three-button segmented control: Going / Maybe / Can't make it.
// Mirrors web app's components/AttendanceControl.tsx.
//
// Usage:
//   AttendanceControl(
//       selection: $myStatus,
//       isEnabled: env.isSignedIn,
//       isLoading: isSaving,
//       onSelect: { newStatus in Task { await save(newStatus) } }
//   )

struct AttendanceControl: View {
    /// Currently selected status. Pass nil for "no RSVP yet".
    @Binding var selection: AttendanceStatus?

    /// When false the control renders in a disabled / guest state.
    var isEnabled: Bool = true

    /// Shows a spinner overlay while an async save is in flight.
    var isLoading: Bool = false

    /// Called when the user taps a segment. Save your data here.
    var onSelect: (AttendanceStatus) -> Void = { _ in }

    private let statuses: [AttendanceStatus] = [.going, .maybe, .notGoing]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(statuses, id: \.self) { status in
                AttendanceSegment(
                    status: status,
                    isSelected: selection == status,
                    isEnabled: isEnabled && !isLoading,
                    action: {
                        selection = status
                        onSelect(status)
                    }
                )
            }
        }
        .overlay {
            if isLoading {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.mlrSurface.opacity(0.6))
                ProgressView()
                    .tint(Color.mlrPrimary)
            }
        }
        .animation(.easeInOut(duration: 0.15), value: selection)
        .animation(.easeInOut(duration: 0.15), value: isLoading)
    }
}

// MARK: - Individual segment button

private struct AttendanceSegment: View {
    let status: AttendanceStatus
    let isSelected: Bool
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(status.emoji)
                    .font(.system(size: 14))
                Text(status.label)
                    .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(isSelected ? .white : labelColor)
            .padding(.vertical, 9)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity)
            .background(backgroundColor)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(borderColor, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.45)
    }

    private var backgroundColor: Color {
        if isSelected { return Color.mlrPrimary }
        return Color.mlrCard
    }

    private var labelColor: Color {
        Color.mlrText
    }

    private var borderColor: Color {
        isSelected ? Color.mlrPrimary : Color.mlrBorder
    }
}

// MARK: - Convenience binding-free version

/// Stateless variant — caller owns selection state externally (e.g. optimistic RSVP in a view model).
struct AttendanceControlStateless: View {
    let selection: AttendanceStatus?
    var isEnabled: Bool = true
    var isLoading: Bool = false
    var onSelect: (AttendanceStatus) -> Void = { _ in }

    @State private var _selection: AttendanceStatus?

    var body: some View {
        AttendanceControl(
            selection: Binding(
                get: { selection ?? _selection },
                set: { _selection = $0 }
            ),
            isEnabled: isEnabled,
            isLoading: isLoading,
            onSelect: onSelect
        )
    }
}

// MARK: - Preview

#if DEBUG
struct AttendanceControl_Previews: PreviewProvider {
    @State static var status: AttendanceStatus? = .going
    @State static var noStatus: AttendanceStatus? = nil
    @State static var loading: AttendanceStatus? = .maybe

    static var previews: some View {
        VStack(spacing: 24) {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "Going selected")
                AttendanceControl(selection: $status, isEnabled: true)
            }

            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "No selection")
                AttendanceControl(selection: $noStatus, isEnabled: true)
            }

            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "Loading / saving")
                AttendanceControl(selection: $loading, isEnabled: true, isLoading: true)
            }

            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "Disabled (guest)")
                AttendanceControl(selection: .constant(nil), isEnabled: false)
            }
        }
        .padding(20)
        .background(Color(.systemGroupedBackground))
        .previewDisplayName("AttendanceControl")
    }
}
#endif
