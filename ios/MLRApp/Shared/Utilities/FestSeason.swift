import Foundation

// MARK: - Fest Season
// Port of lib/festSeason.ts — keep in sync with the web app's version.

enum FestPhase: String, Equatable {
    case offSeason   = "off-season"
    case planning
    case live
    case wrap
}

struct FestSeason: Equatable {
    let phase: FestPhase
    let isLive: Bool
    let isPlanning: Bool
    let isWrap: Bool
    let isTakeover: Bool
    let daysUntilStart: Int
    let isSoon: Bool
    let dayNumber: Int?
    let totalDays: Int
    let daysSinceEnd: Int
    let wrapDaysLeft: Int

    static let planningLeadDays = 60
    static let wrapTailDays     = 14
    static let soonThresholdDays = 7

    static func compute(startISO: String, endISO: String, now: Date = .now) -> FestSeason {
        let fmt = isoFormatter
        guard
            let start = fmt.date(from: startISO),
            let end   = fmt.date(from: endISO)
        else {
            return offSeason(startISO: startISO, endISO: endISO)
        }

        let cal = Calendar.current
        let today = cal.startOfDay(for: now)

        let daysUntilStart = cal.dateComponents([.day], from: today, to: start).day ?? 0
        let daysSinceEnd   = cal.dateComponents([.day], from: end, to: today).day ?? 0
        let totalDays      = (cal.dateComponents([.day], from: start, to: end).day ?? 0) + 1

        let isLive     = today >= start && today <= end
        let isWrap     = daysSinceEnd > 0 && daysSinceEnd <= wrapTailDays
        let isPlanning = !isLive && !isWrap && daysUntilStart > 0 && daysUntilStart <= planningLeadDays
        let isTakeover = isLive || isPlanning || isWrap

        let phase: FestPhase
        if isLive            { phase = .live }
        else if isWrap       { phase = .wrap }
        else if isPlanning   { phase = .planning }
        else                 { phase = .offSeason }

        let dayNumber: Int? = isLive
            ? (cal.dateComponents([.day], from: start, to: today).day ?? 0) + 1
            : nil

        let isSoon = daysUntilStart > 0 && daysUntilStart <= soonThresholdDays

        return FestSeason(
            phase: phase,
            isLive: isLive,
            isPlanning: isPlanning,
            isWrap: isWrap,
            isTakeover: isTakeover,
            daysUntilStart: max(0, daysUntilStart),
            isSoon: isSoon,
            dayNumber: dayNumber,
            totalDays: totalDays,
            daysSinceEnd: max(0, daysSinceEnd),
            wrapDaysLeft: max(0, wrapTailDays - daysSinceEnd)
        )
    }

    private static func offSeason(startISO: String, endISO: String) -> FestSeason {
        FestSeason(
            phase: .offSeason,
            isLive: false, isPlanning: false, isWrap: false, isTakeover: false,
            daysUntilStart: 0, isSoon: false, dayNumber: nil,
            totalDays: 0, daysSinceEnd: 0, wrapDaysLeft: 0
        )
    }
}

// MARK: - Convenience for the app's fixed fest dates

extension FestSeason {
    static func current(now: Date = .now) -> FestSeason {
        compute(
            startISO: FamilyFestConfig.startDate,
            endISO:   FamilyFestConfig.endDate,
            now: now
        )
    }
}

// MARK: - ISO date formatter

private let isoFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone(identifier: "America/Chicago")
    f.locale = Locale(identifier: "en_US_POSIX")
    return f
}()
