import Foundation
import ActivityKit

// MARK: - Family Fest Live Activity Attributes
//
// SHARED FILE — add to BOTH the app target and the MLRWidget extension target
// (the Live Activity UI lives in the widget extension; the app starts/updates it).
//
// During Family Fest week, a Live Activity rides the Lock Screen + Dynamic Island
// showing "Day n of N" and the next scheduled event. Updated from the app via
// `FestLiveActivityController`.

struct FestActivityAttributes: ActivityAttributes {
    public typealias ContentState = ContentStateData

    // Static for the life of the activity
    let festYear: Int
    let totalDays: Int

    struct ContentStateData: Codable, Hashable {
        var dayNumber: Int          // 1-based day of the fest
        var phaseLabel: String      // e.g. "Day 3 of 6"
        var nextEventTitle: String  // e.g. "Fish Fry"
        var nextEventTime: String   // e.g. "6:00 PM"
        var nextEventLocation: String?
        var emoji: String           // contextual emoji for the next event
    }
}
