import WidgetKit
import SwiftUI

// MARK: - Family Fest Countdown Widget
//
// Home Screen / Lock Screen widget counting down to Family Fest. Reads the fest
// dates from FamilyFestConfig (compiled in) and recomputes the phase on each
// timeline refresh, so it stays correct without any network call.
//
// Supported families: systemSmall, systemMedium, accessoryRectangular,
// accessoryCircular (Lock Screen). iOS 26 renders widgets on the Liquid Glass
// canvas; we keep content legible on both light tinted and accented backgrounds.

struct FamilyFestCountdownWidget: Widget {
    let kind = "FamilyFestCountdownWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FestCountdownProvider()) { entry in
            FestCountdownEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Family Fest Countdown")
        .description("Days until Family Fest — and the live day count during the week.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular])
    }
}

// MARK: - Timeline

struct FestCountdownEntry: TimelineEntry {
    let date: Date
    let season: FestSeason
}

struct FestCountdownProvider: TimelineProvider {
    func placeholder(in context: Context) -> FestCountdownEntry {
        .init(date: .now, season: FestSeason.current())
    }

    func getSnapshot(in context: Context, completion: @escaping (FestCountdownEntry) -> Void) {
        completion(.init(date: .now, season: FestSeason.current()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FestCountdownEntry>) -> Void) {
        // Refresh at the next local midnight so the countdown ticks down daily.
        var entries: [FestCountdownEntry] = []
        let cal = Calendar.current
        for dayOffset in 0..<7 {
            if let date = cal.date(byAdding: .day, value: dayOffset, to: cal.startOfDay(for: .now)) {
                entries.append(.init(date: date, season: FestSeason.current(now: date)))
            }
        }
        let nextMidnight = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: .now)) ?? .now
        completion(Timeline(entries: entries, policy: .after(nextMidnight)))
    }
}

// MARK: - View

struct FestCountdownEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FestCountdownEntry

    var body: some View {
        switch family {
        case .accessoryCircular:  circular
        case .accessoryRectangular: rectangular
        case .systemMedium:       medium
        default:                  small
        }
    }

    // MARK: System small

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("🌲 Family Fest")
                .font(.caption2.bold())
                .foregroundStyle(Color.mlrFest)
            Spacer()
            headline
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(URL(string: "mlr://family-fest"))
    }

    // MARK: System medium

    private var medium: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                Text("🌲 Family Fest \(String(FamilyFestConfig.year))")
                    .font(.caption.bold())
                    .foregroundStyle(Color.mlrFest)
                Spacer()
                headline
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if entry.season.isLive {
                PulsingLiveDot(color: .mlrFest)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(URL(string: "mlr://family-fest"))
    }

    // MARK: Lock Screen rectangular

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Family Fest")
                .font(.headline)
            Text(headlineText + " · " + subtitle)
                .font(.caption)
        }
    }

    // MARK: Lock Screen circular

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                if entry.season.isLive, let d = entry.season.dayNumber {
                    Text("D\(d)")
                        .font(.title3.bold())
                    Text("of \(entry.season.totalDays)")
                        .font(.caption2)
                } else {
                    Text("\(entry.season.daysUntilStart)")
                        .font(.title2.bold())
                    Text("days")
                        .font(.caption2)
                }
            }
        }
    }

    // MARK: Shared bits

    private var headline: some View {
        Text(headlineText)
            .font(.system(size: 30, weight: .bold, design: .rounded))
            .foregroundStyle(.primary)
            .minimumScaleFactor(0.6)
            .lineLimit(1)
    }

    private var headlineText: String {
        let s = entry.season
        if s.isLive, let d = s.dayNumber { return "Day \(d)/\(s.totalDays)" }
        if s.isWrap { return "Thanks!" }
        if s.daysUntilStart == 0 { return "Today!" }
        return "\(s.daysUntilStart)"
    }

    private var subtitle: String {
        let s = entry.season
        if s.isLive { return "Happening now" }
        if s.isWrap { return "Post your photos 📸" }
        if s.daysUntilStart == 1 { return "day to go · tomorrow" }
        if s.daysUntilStart <= 0 { return "See you there" }
        return "days to go"
    }
}
