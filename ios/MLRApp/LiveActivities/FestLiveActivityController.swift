import Foundation
import ActivityKit

// MARK: - Fest Live Activity Controller
//
// App-side controller that starts, updates, and ends the Family Fest Live Activity.
// Call `refresh(season:schedule:)` on app launch and when the schedule changes;
// it starts the activity when the fest goes live, updates the day + next event,
// and ends it when the fest is over.
//
// Requires "Supports Live Activities" = YES in Info.plist (NSSupportsLiveActivities).

@MainActor
final class FestLiveActivityController {
    static let shared = FestLiveActivityController()

    private var activity: Activity<FestActivityAttributes>?

    private init() {
        // Re-attach to an already-running activity after a cold launch.
        activity = Activity<FestActivityAttributes>.activities.first
    }

    var isActive: Bool { activity != nil }

    /// Drive the activity off the current season + schedule. Idempotent.
    func refresh(season: FestSeason, schedule: [ScheduleItem]) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        if season.isLive, let dayNumber = season.dayNumber {
            let state = makeState(dayNumber: dayNumber,
                                  totalDays: season.totalDays,
                                  schedule: schedule)
            if activity == nil {
                start(totalDays: season.totalDays, state: state)
            } else {
                update(state)
            }
        } else {
            // Not live — make sure nothing lingers.
            Task { await end() }
        }
    }

    private func start(totalDays: Int, state: FestActivityAttributes.ContentState) {
        let attributes = FestActivityAttributes(festYear: FamilyFestConfig.year,
                                                totalDays: totalDays)
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: nil),
                pushType: nil // local updates; switch to .token for remote push later
            )
        } catch {
            print("[FestLiveActivity] start failed: \(error)")
        }
    }

    private func update(_ state: FestActivityAttributes.ContentState) {
        guard let activity else { return }
        Task {
            await activity.update(.init(state: state, staleDate: nil))
        }
    }

    func end() async {
        guard let activity else { return }
        await activity.end(nil, dismissalPolicy: .immediate)
        self.activity = nil
    }

    // MARK: - State assembly

    private func makeState(dayNumber: Int,
                           totalDays: Int,
                           schedule: [ScheduleItem]) -> FestActivityAttributes.ContentState {
        let today = todayName()
        let next = schedule.first { $0.day == today }
        return .init(
            dayNumber: dayNumber,
            phaseLabel: "Day \(dayNumber) of \(totalDays)",
            nextEventTitle: next?.title ?? "Free time",
            nextEventTime: next?.time ?? "All day",
            nextEventLocation: next?.location,
            emoji: emoji(for: next?.title ?? "")
        )
    }

    private func todayName() -> String {
        let f = DateFormatter()
        f.dateFormat = "EEEE"
        f.timeZone = TimeZone(identifier: "America/Chicago")
        return f.string(from: .now)
    }

    private func emoji(for title: String) -> String {
        let t = title.lowercased()
        if t.contains("fish") { return "🎣" }
        if t.contains("bonfire") || t.contains("fire") { return "🔥" }
        if t.contains("dinner") || t.contains("breakfast") || t.contains("cookout") { return "🍽️" }
        if t.contains("golf") { return "⛳" }
        if t.contains("boat") || t.contains("pontoon") || t.contains("kayak") { return "⛵" }
        if t.contains("talent") { return "🎤" }
        if t.contains("photo") { return "📸" }
        if t.contains("olympics") || t.contains("scavenger") { return "🏅" }
        return "🌲"
    }
}
