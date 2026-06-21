import SwiftUI

// MARK: - UpcomingEventCard
// Spotlights the nearest upcoming non-Family-Fest event on Home.
// Mirrors components/UpcomingEvents.tsx.

struct UpcomingEventCard: View {
    let event: ResortEvent
    let attendance: EventAttendance?
    /// Optional caller-managed optimistic status override (Home manages it at top level).
    var currentStatusOverride: AttendanceStatus? = nil
    let onAttendanceChange: (AttendanceStatus) async -> Void

    @Environment(AppEnvironment.self) private var env
    @State private var showEventSheet = false

    private var displayStatus: AttendanceStatus? {
        currentStatusOverride ?? attendance?.effectiveStatus()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Kind badge + title row
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    EventKindBadge(kind: event.kind)
                    Text(event.title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.mlrText)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(MLRFormat.dateRange(start: event.startDate, end: event.endDate))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.mlrPrimary)
                    EventWeatherBadge(isoDate: event.startDate)
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
                    // AttendanceControlStateless (Shared/Components/AttendanceControl.swift)
                    AttendanceControlStateless(
                        selection: displayStatus,
                        isEnabled: true,
                        onSelect: { status in
                            Haptics.select()
                            Task { await onAttendanceChange(status) }
                        }
                    )
                } else {
                    // Shared SignInChip from GuardView.swift
                    SignInChip()
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
            EventSheet(event: event)
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

// AttendanceControl / AttendanceControlStateless — Shared/Components/AttendanceControl.swift
// SignInChip — Shared/Components/GuardView.swift
