import SwiftUI

// MARK: - FestScheduleView

struct FestScheduleView: View {
    @Environment(AppEnvironment.self) private var env

    private let festDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    private var itemsByDay: [(day: String, items: [ScheduleItem])] {
        festDays.compactMap { day in
            let items = ScheduleItem.seed.filter { $0.day == day }
            guard !items.isEmpty else { return nil }
            return (day: day, items: items)
        }
    }

    private var thingsToDo: [ScheduleItem] {
        ScheduleItem.seed.filter { $0.day == "Anytime" }
    }

    /// ISO date (yyyy-MM-dd) for a fest day name, derived from the fest start
    /// date + the day's offset in `festDays`. Returns nil for "Anytime" / unknowns.
    private func isoDate(forDay day: String) -> String? {
        guard let offset = festDays.firstIndex(of: day),
              let start = WeatherService.isoFormatter.date(from: FamilyFestConfig.startDate),
              let date = Calendar.current.date(byAdding: .day, value: offset, to: start)
        else { return nil }
        return WeatherService.isoFormatter.string(from: date)
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {

                // Scheduled events by day
                ForEach(itemsByDay, id: \.day) { group in
                    Section {
                        VStack(spacing: 1) {
                            ForEach(group.items) { item in
                                NavigationLink(destination: FestScheduleDetailView(item: item)) {
                                    ScheduleRow(item: item, isSignedIn: env.isSignedIn)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .background(Color.mlrFestParchment)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(Color.mlrFest.opacity(0.15), lineWidth: 1)
                        )
                        .padding(.horizontal, 16)
                        .padding(.bottom, 16)
                    } header: {
                        DayHeader(day: group.day, isoDate: isoDate(forDay: group.day))
                    }
                }

                // Things To Do (anytime)
                if !thingsToDo.isEmpty {
                    Section {
                        VStack(spacing: 1) {
                            ForEach(thingsToDo) { item in
                                NavigationLink(destination: FestScheduleDetailView(item: item)) {
                                    ScheduleRow(item: item, isSignedIn: env.isSignedIn)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .background(Color.mlrFestParchment)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(Color.mlrFest.opacity(0.15), lineWidth: 1)
                        )
                        .padding(.horizontal, 16)
                        .padding(.bottom, 24)
                    } header: {
                        DayHeader(day: "Things To Do")
                    }
                }
            }
            .padding(.top, 8)
        }
        .background(Color.mlrFestParchment)
    }
}

// MARK: - Day Header

private struct DayHeader: View {
    let day: String
    var isoDate: String? = nil

    var body: some View {
        HStack {
            Text(day.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.mlrFest.opacity(0.65))
                .tracking(1.2)
            Spacer()
            // Self-hides when WeatherKit has no forecast for the date (e.g. far out).
            if let isoDate {
                EventWeatherBadge(isoDate: isoDate)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.mlrFestParchment)
    }
}

// MARK: - Schedule Row

private struct ScheduleRow: View {
    let item: ScheduleItem
    let isSignedIn: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            // Time column
            Text(item.time)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(Color.mlrFest.opacity(0.6))
                .frame(width: 62, alignment: .leading)
                .padding(.top, 1)

            // Content column
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.festSerif(14, weight: .bold))
                    .foregroundStyle(Color.mlrFest)
                    .multilineTextAlignment(.leading)

                if let location = item.location {
                    if isSignedIn {
                        Label(location, systemImage: "mappin.and.ellipse")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.mlrFest.opacity(0.6))
                    } else {
                        Label("Sign in to see location", systemImage: "lock.fill")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.mlrFest.opacity(0.4))
                    }
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.mlrFest.opacity(0.3))
                .padding(.top, 2)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color.mlrFestParchment)
    }
}
