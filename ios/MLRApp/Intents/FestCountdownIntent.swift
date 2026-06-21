import AppIntents
import SwiftUI

// MARK: - Family Fest Countdown Intent
//
// "Hey Siri, how many days until Family Fest?" — computes the phase locally from
// FamilyFestConfig, no network needed.

struct FestCountdownIntent: AppIntent {
    static var title: LocalizedStringResource = "Family Fest Countdown"
    static var description = IntentDescription("Tells you how long until Family Fest.")
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
        let season = FestSeason.current()
        let spoken: String
        let headline: String

        switch season.phase {
        case .live:
            let day = season.dayNumber ?? 1
            spoken = "Family Fest is happening now — it's day \(day) of \(season.totalDays)."
            headline = "Day \(day) of \(season.totalDays)"
        case .wrap:
            spoken = "Family Fest just wrapped. Don't forget to post your photos!"
            headline = "Just wrapped 📸"
        case .planning, .offSeason:
            let days = season.daysUntilStart
            if days == 0 {
                spoken = "Family Fest starts today!"
                headline = "Today!"
            } else if days == 1 {
                spoken = "Family Fest starts tomorrow!"
                headline = "Tomorrow"
            } else {
                spoken = "Family Fest is \(days) days away."
                headline = "\(days) days"
            }
        }

        return .result(
            dialog: IntentDialog(stringLiteral: spoken),
            view: IntentEventSnippet(title: "Family Fest \(String(FamilyFestConfig.year))",
                                     dateLabel: headline, emoji: "🌲")
        )
    }
}
