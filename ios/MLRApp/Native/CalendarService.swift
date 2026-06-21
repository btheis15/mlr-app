import Foundation
import EventKit

// MARK: - Calendar Service (EventKit)
//
// One-tap "Add to Calendar" for resort events, Family Fest, work weekends, and a
// member's birthday — so the family's own Apple Calendar fills with resort dates.
// Also schedules local reminders for dues deadlines / RSVP'd events.
//
// Requires `NSCalendarsWriteOnlyAccessUsageDescription` (iOS 17+ write-only scope)
// in Info.plist. We only ever WRITE events, so request write-only access — no need
// to read the user's calendar.

@Observable
final class CalendarService {
    static let shared = CalendarService()
    private let store = EKEventStore()
    private init() {}

    enum CalendarError: Error { case accessDenied, saveFailed }

    /// Request write-only calendar access (iOS 17+).
    func requestAccess() async throws {
        let granted = try await store.requestWriteOnlyAccessToEvents()
        guard granted else { throw CalendarError.accessDenied }
    }

    /// Add a resort event to the user's default calendar. Returns the identifier
    /// so the caller can show "Added ✓".
    @discardableResult
    func addEvent(title: String,
                  startISO: String,
                  endISO: String?,
                  location: String?,
                  notes: String?,
                  allDay: Bool = true) async throws -> String {
        try await requestAccess()

        let event = EKEvent(eventStore: store)
        event.title = title
        event.location = location
        event.notes = notes
        event.calendar = store.defaultCalendarForNewEvents

        let fmt = Self.isoFormatter
        guard let start = fmt.date(from: startISO) else { throw CalendarError.saveFailed }
        event.startDate = start
        event.isAllDay = allDay
        if let endISO, let end = fmt.date(from: endISO) {
            // EventKit end date is exclusive for all-day spans; add a day.
            event.endDate = allDay ? (Calendar.current.date(byAdding: .day, value: 1, to: end) ?? end) : end
        } else {
            event.endDate = allDay ? start : start.addingTimeInterval(3600)
        }

        // Default 1-day-before alert for non-fest events.
        event.addAlarm(EKAlarm(relativeOffset: -86400))

        do {
            try store.save(event, span: .thisEvent)
            return event.eventIdentifier
        } catch {
            throw CalendarError.saveFailed
        }
    }

    /// Add a member's birthday as a yearly all-day event with a morning reminder.
    @discardableResult
    func addBirthday(memberName: String, birthdayISO: String) async throws -> String {
        try await requestAccess()
        let fmt = Self.isoFormatter
        guard let date = fmt.date(from: birthdayISO) else { throw CalendarError.saveFailed }

        let event = EKEvent(eventStore: store)
        event.title = "🎂 \(memberName)'s Birthday"
        event.isAllDay = true
        event.startDate = date
        event.endDate = date
        event.calendar = store.defaultCalendarForNewEvents

        let rule = EKRecurrenceRule(recurrenceWith: .yearly, interval: 1, end: nil)
        event.addRecurrenceRule(rule)
        // Alert at 9am the day of.
        event.addAlarm(EKAlarm(relativeOffset: 9 * 3600))

        do {
            try store.save(event, span: .futureEvents)
            return event.eventIdentifier
        } catch {
            throw CalendarError.saveFailed
        }
    }

    static let isoFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "America/Chicago")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
}
