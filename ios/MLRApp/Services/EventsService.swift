import Foundation
import Supabase

// MARK: - EventsService

@Observable
@MainActor
final class EventsService {
    /// Merged seed + DB events, sorted by startDate ascending.
    var events: [ResortEvent] = []

    /// Current user's RSVP per eventId.
    var attendances: [String: EventAttendance] = [:]

    /// Attendance summary (going/maybe/notGoing counts) per eventId.
    var summaries: [String: AttendanceSummary] = [:]

    var isLoading: Bool = false
    var error: String? = nil

    // MARK: - Computed

    /// All events starting today or later, sorted ascending.
    var upcomingEvents: [ResortEvent] {
        let today = Calendar.current.startOfDay(for: .now)
        return events
            .filter { event in
                guard let start = event.startDateParsed else { return false }
                let endDay = event.endDateParsed ?? start
                return endDay >= today
            }
            .sorted { a, b in
                (a.startDateParsed ?? .distantFuture) < (b.startDateParsed ?? .distantFuture)
            }
    }

    /// The nearest upcoming non-Family-Fest event.
    /// Returns nil when the fest takeover is active (callers check FestSeason themselves).
    var nearestEvent: ResortEvent? {
        upcomingEvents.first { !$0.isFamilyFest }
    }

    // MARK: - Fetch events

    func fetchEvents() async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let dbEvents: [ResortEvent] = try await supabase
                .from("events")
                .select("*")
                .execute()
                .value

            // Merge: DB rows take precedence over seed rows with the same id.
            // Family Fest is always synthesized from FamilyFestConfig, never from DB.
            var merged: [String: ResortEvent] = [:]
            for event in ResortEvent.seedEvents {
                merged[event.id] = event
            }
            for event in dbEvents where !event.isFamilyFest {
                merged[event.id] = event
            }

            // Always include the synthesized Family Fest event
            let fest = synthesizeFamilyFest()
            merged[fest.id] = fest

            events = Array(merged.values).sorted {
                ($0.startDateParsed ?? .distantFuture) < ($1.startDateParsed ?? .distantFuture)
            }
        } catch {
            self.error = "Couldn't load events."
            print("[EventsService] fetchEvents error: \(error)")
            // Fall back to seed data so the UI isn't empty
            events = ResortEvent.seedEvents
        }
    }

    // MARK: - Attendance

    func fetchAttendance(userId: UUID) async {
        do {
            let rows: [EventAttendance] = try await supabase
                .from("event_attendance")
                .select("*")
                .eq("user_id", value: userId.uuidString)
                .execute()
                .value
            var map: [String: EventAttendance] = [:]
            for row in rows { map[row.eventId] = row }
            attendances = map
        } catch {
            print("[EventsService] fetchAttendance error: \(error)")
        }
    }

    func fetchSummary(eventId: String) async -> AttendanceSummary {
        struct SummaryRow: Decodable {
            let status: AttendanceStatus
            let count: Int
        }
        do {
            let rows: [SummaryRow] = try await supabase
                .from("event_attendance")
                .select("status, count:id.count()")
                .eq("event_id", value: eventId)
                .execute()
                .value
            var going = 0, maybe = 0, notGoing = 0
            for row in rows {
                switch row.status {
                case .going:    going    += row.count
                case .maybe:    maybe    += row.count
                case .notGoing: notGoing += row.count
                }
            }
            let summary = AttendanceSummary(going: going, maybe: maybe, notGoing: notGoing)
            summaries[eventId] = summary
            return summary
        } catch {
            print("[EventsService] fetchSummary error: \(error)")
            return summaries[eventId] ?? AttendanceSummary(going: 0, maybe: 0, notGoing: 0)
        }
    }

    func upsertAttendance(eventId: String, status: AttendanceStatus, days: [String: AttendanceStatus]? = nil) async throws {
        struct UpsertParams: Encodable {
            let p_event_id: String
            let p_status: String
            let p_days: [String: String]?
        }
        let daysRaw = days.map { dict in dict.mapValues(\.rawValue) }
        try await supabase
            .rpc("upsert_event_attendance", params: UpsertParams(
                p_event_id: eventId,
                p_status: status.rawValue,
                p_days: daysRaw
            ))
            .execute()

        // Optimistic local update
        if var existing = attendances[eventId] {
            existing = EventAttendance(
                id: existing.id,
                eventId: eventId,
                userId: existing.userId,
                status: status,
                days: days,
                updatedAt: .now
            )
            attendances[eventId] = existing
        }
    }

    // MARK: - Who is going

    func fetchWhoIsGoing(eventId: String) async throws -> [Profile] {
        let rows: [AttendanceWithProfile] = try await supabase
            .from("event_attendance")
            .select("""
                status,
                profiles!user_id(id, name, email, avatar_url, phone, is_admin,
                                 beta_tester, willing_to_help, intro_seen,
                                 email_alerts, push_level, push_types,
                                 notif_types, push_prompted, created_at)
            """)
            .eq("event_id", value: eventId)
            .in("status", values: ["going", "maybe"])
            .execute()
            .value
        return rows.compactMap(\.profile)
    }

    // MARK: - Admin: create / update / delete

    func createEvent(
        title: String,
        description: String?,
        kind: EventKind,
        startDate: String,
        endDate: String?,
        location: String?,
        dayRsvp: Bool
    ) async throws {
        struct CreateParams: Encodable {
            let p_title: String
            let p_description: String?
            let p_kind: String
            let p_start_date: String
            let p_end_date: String?
            let p_location: String?
            let p_day_rsvp: Bool
        }
        try await supabase
            .rpc("create_event", params: CreateParams(
                p_title: title,
                p_description: description,
                p_kind: kind.rawValue,
                p_start_date: startDate,
                p_end_date: endDate,
                p_location: location,
                p_day_rsvp: dayRsvp
            ))
            .execute()
        await fetchEvents()
    }

    func updateEvent(
        id: String,
        title: String,
        description: String?,
        startDate: String,
        endDate: String?,
        location: String?,
        dayRsvp: Bool
    ) async throws {
        var params: [String: AnyJSON] = [
            "title":      .string(title),
            "start_date": .string(startDate),
            "day_rsvp":   .bool(dayRsvp)
        ]
        if let description { params["description"] = .string(description) }
        if let endDate      { params["end_date"]    = .string(endDate) }
        if let location     { params["location"]    = .string(location) }

        try await supabase
            .from("events")
            .update(params)
            .eq("id", value: id)
            .execute()
        await fetchEvents()
    }

    func deleteEvent(id: String) async throws {
        struct DeleteParams: Encodable { let p_event_id: String }
        try await supabase
            .rpc("delete_event", params: DeleteParams(p_event_id: id))
            .execute()
        events.removeAll { $0.id == id }
        summaries.removeValue(forKey: id)
    }

    // MARK: - Helpers

    private func synthesizeFamilyFest() -> ResortEvent {
        ResortEvent(
            id: FamilyFestConfig.id,
            title: "Family Fest \(FamilyFestConfig.year)",
            description: "The annual Theis Family gathering at Muskellunge Lake Resort.",
            kind: .familyFest,
            startDate: FamilyFestConfig.startDate,
            endDate: FamilyFestConfig.endDate,
            location: "Muskellunge Lake Resort",
            dayRsvp: true,
            source: .seed
        )
    }
}

// MARK: - Attendance row with embedded profile

private struct AttendanceWithProfile: Decodable {
    let status: AttendanceStatus
    let profile: Profile?

    enum CodingKeys: String, CodingKey {
        case status
        case profile = "profiles"
    }
}
