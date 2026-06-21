import SwiftUI

// MARK: - FestStatus
// Phase-aware status card shown at the top of FestOverviewView.
// Mirrors the FestStatus component from the web app.

struct FestStatus: View {
    let season: FestSeason

    var body: some View {
        switch season.phase {
        case .offSeason:
            OffSeasonCard()
        case .planning:
            PlanningCard(season: season)
        case .live:
            LiveCard(season: season)
        case .wrap:
            WrapCard(season: season)
        }
    }
}

// MARK: - Off-Season

private struct OffSeasonCard: View {
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "star.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.mlrFest.opacity(0.5))

            VStack(alignment: .leading, spacing: 2) {
                Text("Family Fest 2026")
                    .font(.festSerif(15, weight: .bold))
                    .foregroundStyle(Color.mlrFest)
                Text("Aug 2–8 · Tomahawk, WI")
                    .font(.festSerif(12))
                    .foregroundStyle(Color.mlrFest.opacity(0.65))
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.mlrFestParchment)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(Color.mlrFest.opacity(0.2), lineWidth: 1)
                )
        )
    }
}

// MARK: - Planning

private struct PlanningCard: View {
    let season: FestSeason

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "calendar.badge.clock")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.mlrFest)
                Text("\(season.daysUntilStart) days until the Fest")
                    .font(.festSerif(16, weight: .bold))
                    .foregroundStyle(Color.mlrFest)
                Spacer()
            }

            Text("Planning is underway — volunteers needed!")
                .font(.festSerif(13))
                .foregroundStyle(Color.mlrFest.opacity(0.75))

            Label("Sign up to help", systemImage: "hand.raised.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(Color.mlrFest)
                .clipShape(Capsule())
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.mlrFest.opacity(0.07))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(Color.mlrFest.opacity(0.25), lineWidth: 1.5)
                )
        )
    }
}

// MARK: - Live

private struct LiveCard: View {
    let season: FestSeason
    @State private var dotPulse = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 10) {
                // Live pulsing dot
                ZStack {
                    Circle()
                        .fill(Color.mlrSuccess.opacity(0.3))
                        .frame(width: 20, height: 20)
                        .scaleEffect(dotPulse ? 1.5 : 1)
                        .animation(.easeInOut(duration: 1).repeatForever(autoreverses: true), value: dotPulse)
                    Circle()
                        .fill(Color.mlrSuccess)
                        .frame(width: 10, height: 10)
                }

                if let day = season.dayNumber {
                    Text("Day \(day) of \(season.totalDays)")
                        .font(.festSerif(20, weight: .bold))
                        .foregroundStyle(Color.mlrFest)
                }

                Spacer()

                // Live badge
                Text("LIVE")
                    .font(.system(size: 10, weight: .black))
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.mlrSuccess)
                    .clipShape(Capsule())
            }

            Text("Today at the Fest")
                .font(.festSerif(13))
                .foregroundStyle(Color.mlrFest.opacity(0.75))

            // Today's schedule items
            let todayItems = todayScheduleItems()
            if !todayItems.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(todayItems) { item in
                        HStack(spacing: 6) {
                            Text(item.time)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(Color.mlrFest.opacity(0.6))
                                .frame(width: 60, alignment: .leading)
                            Text(item.title)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Color.mlrFest)
                        }
                    }
                }
                .padding(.top, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.mlrFest.opacity(0.07))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(Color.mlrFest.opacity(0.3), lineWidth: 1.5)
                )
        )
        .onAppear { dotPulse = true }
    }

    private func todayScheduleItems() -> [ScheduleItem] {
        guard let dayNum = season.dayNumber else { return [] }
        let days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        // dayNumber is 1-based; fest starts Sunday (index 0)
        guard dayNum >= 1 && dayNum <= days.count else { return [] }
        let dayName = days[dayNum - 1]
        return ScheduleItem.seed.filter { $0.day == dayName }
    }
}

// MARK: - Wrap

private struct WrapCard: View {
    let season: FestSeason

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("📸")
                    .font(.system(size: 22))
                Text("Thanks for a great Fest!")
                    .font(.festSerif(16, weight: .bold))
                    .foregroundStyle(Color.mlrFest)
                Spacer()
            }

            Text("\(season.wrapDaysLeft) day\(season.wrapDaysLeft == 1 ? "" : "s") left to post photos")
                .font(.festSerif(13))
                .foregroundStyle(Color.mlrFest.opacity(0.75))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.mlrFest.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(Color.mlrFest.opacity(0.25), lineWidth: 1.5)
                )
        )
    }
}
