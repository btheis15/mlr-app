import SwiftUI

// MARK: - UpcomingEventCard
// Spotlights the nearest upcoming non-Family-Fest event on Home.
// Mirrors components/UpcomingEvents.tsx.

struct UpcomingEventCard: View {
    let event: ResortEvent
    let attendance: EventAttendance?
    let onAttendanceChange: (AttendanceStatus) async -> Void

    @Environment(AppEnvironment.self) private var env
    @State private var showEventSheet = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Kind badge + title
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    EventKindBadge(kind: event.kind)
                    Text(event.title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.mlrText)
                }
                Spacer()
                // Date
                VStack(alignment: .trailing, spacing: 2) {
                    Text(MLRFormat.dateRange(start: event.startDate, end: event.endDate))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.mlrPrimary)
                    if let location = event.location {
                        Text(location)
                            .font(.caption)
                            .foregroundStyle(Color.mlrTextMuted)
                            .multilineTextAlignment(.trailing)
                    }
                }
            }

            // Description snippet
            if let desc = event.description {
                Text(desc)
                    .font(.subheadline)
                    .foregroundStyle(Color.mlrTextMuted)
                    .lineLimit(2)
            }

            Divider()

            // Attendance control + "see who's going"
            HStack {
                if env.isSignedIn {
                    AttendanceControl(
                        currentStatus: attendance?.effectiveStatus(),
                        onSelect: { status in
                            await onAttendanceChange(status)
                        }
                    )
                } else {
                    SignInChip(label: "RSVP") { }
                }

                Spacer()

                Button {
                    showEventSheet = true
                } label: {
                    Label("Who's going", systemImage: "person.2")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.mlrPrimary)
                }
            }
        }
        .padding(16)
        .cardStyle()
        .sheet(isPresented: $showEventSheet) {
            EventSheet(event: event, attendance: attendance)
        }
    }
}

// MARK: - EventKindBadge

struct EventKindBadge: View {
    let kind: EventKind

    var body: some View {
        Text(label)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(tintColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tintColor.opacity(0.12))
            .clipShape(Capsule())
    }

    private var label: String {
        switch kind {
        case .familyFest:  return "Family Fest"
        case .workWeekend: return "Work Weekend"
        case .holiday:     return "Holiday"
        case .custom:      return "Event"
        }
    }

    private var tintColor: Color {
        switch kind {
        case .familyFest:  return Color.mlrFest
        case .workWeekend: return Color.mlrAccent
        case .holiday:     return Color.mlrPrimary
        case .custom:      return Color.mlrInfo
        }
    }
}

// MARK: - AttendanceControl
// Three-segment going / maybe / can't-make-it picker.
// Used here and on the Events tab.

struct AttendanceControl: View {
    let currentStatus: AttendanceStatus?
    let onSelect: (AttendanceStatus) async -> Void

    @State private var isUpdating = false

    private let statuses: [AttendanceStatus] = [.going, .maybe, .notGoing]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(statuses, id: \.rawValue) { status in
                Button {
                    guard !isUpdating else { return }
                    Task {
                        isUpdating = true
                        await onSelect(status)
                        isUpdating = false
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(status.emoji)
                            .font(.system(size: 13))
                        Text(status.label)
                            .font(.system(size: 12, weight: .medium))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(currentStatus == status ? Color.mlrPrimary : Color.clear)
                    .foregroundStyle(currentStatus == status ? Color.white : Color.mlrTextMuted)
                }
            }
        }
        .background(Color.mlrCard)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Color.mlrBorder, lineWidth: 1)
        )
        .opacity(isUpdating ? 0.6 : 1)
        .animation(.easeInOut(duration: 0.15), value: currentStatus)
    }
}

// MARK: - SignInChip
// Inline sign-in prompt used in place of gated actions.

struct SignInChip: View {
    let label: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Label(label, systemImage: "lock.fill")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.mlrTextMuted)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(Color.mlrCard)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(Color.mlrBorder, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}
