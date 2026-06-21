import SwiftUI

// MARK: - EventCard
// Compact calendar card for an event: title, kind badge, date range,
// going count, and the user's current attendance chip. Tap opens EventSheet.
// Family Fest is styled with the heraldic-wine accent.

struct EventCard: View {
    let event: ResortEvent
    var summary: AttendanceSummary?
    var myStatus: AttendanceStatus?
    let onTap: () -> Void

    private var accent: Color {
        EventKindStyle.color(for: event.kind)
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        KindBadge(kind: event.kind)
                        Text(event.title)
                            .font(event.isFamilyFest
                                  ? .festSerif(20, weight: .bold)
                                  : .system(size: 18, weight: .bold))
                            .foregroundStyle(event.isFamilyFest ? Color.mlrFest : Color.mlrText)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.mlrTextSubtle)
                }

                HStack(spacing: 14) {
                    Label(MLRFormat.dateRange(start: event.startDate, end: event.endDate),
                          systemImage: "calendar")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.mlrTextMuted)

                    if let location = event.location, !location.isEmpty {
                        Label(location, systemImage: "mappin.and.ellipse")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.mlrTextMuted)
                            .lineLimit(1)
                    }

                    EventWeatherBadge(isoDate: event.startDate)
                }

                HStack {
                    if let summary, summary.going > 0 {
                        HStack(spacing: 4) {
                            Image(systemName: "person.2.fill")
                                .font(.system(size: 11))
                            Text("\(summary.going) going")
                                .font(.system(size: 13, weight: .medium))
                        }
                        .foregroundStyle(accent)
                    }
                    Spacer()
                    if let myStatus {
                        Text("\(myStatus.emoji) \(myStatus.label)")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(accent)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(accent.opacity(0.12))
                            .clipShape(Capsule())
                    }
                }
            }
            .padding(16)
            .background(event.isFamilyFest ? Color.mlrFestLight : Color.mlrCard)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(event.isFamilyFest ? Color.mlrFest.opacity(0.25) : .clear,
                                  lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Kind Badge

struct KindBadge: View {
    let kind: EventKind

    var body: some View {
        Text(EventKindStyle.label(for: kind))
            .font(.system(size: 10, weight: .bold))
            .tracking(0.6)
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(EventKindStyle.color(for: kind))
            .clipShape(Capsule())
    }
}

// MARK: - Kind styling

enum EventKindStyle {
    static func color(for kind: EventKind) -> Color {
        switch kind {
        case .familyFest:  return .mlrFest
        case .workWeekend: return .mlrPrimary
        case .holiday:     return .mlrInfo
        case .custom:      return .mlrTextMuted
        }
    }

    static func label(for kind: EventKind) -> String {
        switch kind {
        case .familyFest:  return "FAMILY FEST"
        case .workWeekend: return "WORK WEEKEND"
        case .holiday:     return "HOLIDAY"
        case .custom:      return "EVENT"
        }
    }
}
