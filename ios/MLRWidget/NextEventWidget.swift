import WidgetKit
import SwiftUI

// MARK: - Next Event Widget
//
// Shows the nearest upcoming resort event. The app writes the next event into the
// shared App Group UserDefaults (`SharedStore`) whenever events refresh; the widget
// reads that snapshot so it works offline and without a Supabase call in the
// extension. If nothing has been written yet it falls back to the seed events.

struct NextEventWidget: Widget {
    let kind = "NextEventWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NextEventProvider()) { entry in
            NextEventEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Next at the Resort")
        .description("The next upcoming gathering at Muskellunge Lake Resort.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct NextEventEntry: TimelineEntry {
    let date: Date
    let title: String
    let dateLabel: String
    let kindEmoji: String
    let hasEvent: Bool
}

struct NextEventProvider: TimelineProvider {
    func placeholder(in context: Context) -> NextEventEntry {
        .init(date: .now, title: "Family Fest 2026", dateLabel: "Aug 2", kindEmoji: "🌲", hasEvent: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (NextEventEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextEventEntry>) -> Void) {
        let entry = currentEntry()
        let cal = Calendar.current
        let nextMidnight = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: .now)) ?? .now
        completion(Timeline(entries: [entry], policy: .after(nextMidnight)))
    }

    private func currentEntry() -> NextEventEntry {
        // Read the app's shared snapshot; fall back to seed events.
        if let snapshot = SharedStore.shared.nextEvent {
            return .init(date: .now,
                         title: snapshot.title,
                         dateLabel: MLRFormat.shortDateISO(snapshot.startDate),
                         kindEmoji: snapshot.emoji,
                         hasEvent: true)
        }
        let upcoming = ResortEvent.seedEvents
            .filter { ($0.startDateParsed ?? .distantPast) >= Calendar.current.startOfDay(for: .now) }
            .sorted { ($0.startDateParsed ?? .distantFuture) < ($1.startDateParsed ?? .distantFuture) }
        guard let next = upcoming.first else {
            return .init(date: .now, title: "Nothing scheduled", dateLabel: "", kindEmoji: "🌲", hasEvent: false)
        }
        return .init(date: .now,
                     title: next.title,
                     dateLabel: MLRFormat.shortDateISO(next.startDate),
                     kindEmoji: emoji(for: next.kind),
                     hasEvent: true)
    }

    private func emoji(for kind: EventKind) -> String {
        switch kind {
        case .familyFest: return "🌲"
        case .workWeekend: return "🔨"
        case .holiday: return "🎉"
        case .custom: return "📅"
        }
    }
}

struct NextEventEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NextEventEntry

    var body: some View {
        if family == .accessoryRectangular {
            VStack(alignment: .leading, spacing: 2) {
                Text("Next at MLR").font(.headline)
                Text("\(entry.kindEmoji) \(entry.title)").font(.caption).lineLimit(1)
                Text(entry.dateLabel).font(.caption2).foregroundStyle(.secondary)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("Next at the resort")
                    .font(.caption2.bold())
                    .foregroundStyle(Color.mlrPrimary)
                Spacer()
                Text(entry.kindEmoji)
                    .font(.system(size: family == .systemMedium ? 40 : 32))
                Text(entry.title)
                    .font(.headline)
                    .lineLimit(2)
                Text(entry.dateLabel)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .widgetURL(URL(string: "mlr://events"))
        }
    }
}
