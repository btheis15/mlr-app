import Foundation
import Supabase

// MARK: - HelpService

@Observable
@MainActor
final class HelpService {
    var openRequests: [HelpRequest] = []
    var isLoading: Bool = false
    var error: String? = nil

    private var realtimeChannel: RealtimeChannelV2? = nil

    /// How many days ± an event window for presence detection (mirrors EVENT_PRESENCE_GRACE_DAYS).
    private static let presenceGraceDays = 2

    // MARK: - Fetch

    func fetchOpenRequests() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let rows: [HelpRequest] = try await supabase
                .from("help_requests")
                .select("""
                    *,
                    help_responses(id, request_id, responder_id, responder_name, created_at)
                """)
                .eq("status", value: "open")
                .order("created_at", ascending: false)
                .execute()
                .value
            openRequests = rows
        } catch {
            self.error = "Couldn't load help requests."
            print("[HelpService] fetchOpenRequests error: \(error)")
        }
    }

    // MARK: - Request help

    func requestHelp(
        category: HelpCategory,
        what: String,
        neededCount: Int,
        whereDescription: String?,
        latitude: Double?,
        longitude: Double?,
        scheduledFor: Date?,
        notifyAll: Bool
    ) async throws {
        let eventIds = helpTargeting()

        struct RequestParams: Encodable {
            let p_category: String
            let p_what: String
            let p_needed_count: Int
            let p_where_description: String?
            let p_latitude: Double?
            let p_longitude: Double?
            let p_scheduled_for: String?
            let p_notify_all: Bool
            let p_event_ids: [String]
        }

        let iso = ISO8601DateFormatter()
        let scheduledStr = scheduledFor.map { iso.string(from: $0) }

        try await supabase
            .rpc("request_help", params: RequestParams(
                p_category: category.rawValue,
                p_what: what,
                p_needed_count: neededCount,
                p_where_description: whereDescription,
                p_latitude: latitude,
                p_longitude: longitude,
                p_scheduled_for: scheduledStr,
                p_notify_all: notifyAll,
                p_event_ids: eventIds
            ))
            .execute()

        // Refresh after posting
        await fetchOpenRequests()
    }

    // MARK: - Respond / withdraw

    func respondToHelp(requestId: UUID) async throws {
        struct RespondParams: Encodable { let p_request_id: String }
        try await supabase
            .rpc("respond_to_help", params: RespondParams(p_request_id: requestId.uuidString))
            .execute()
        await fetchOpenRequests()
    }

    func withdrawHelp(requestId: UUID) async throws {
        struct WithdrawParams: Encodable { let p_request_id: String }
        try await supabase
            .rpc("withdraw_help", params: WithdrawParams(p_request_id: requestId.uuidString))
            .execute()
        await fetchOpenRequests()
    }

    // MARK: - Status (admin / requester)

    func setStatus(requestId: UUID, status: HelpRequestStatus) async throws {
        struct StatusParams: Encodable {
            let p_request_id: String
            let p_status: String
        }
        try await supabase
            .rpc("set_help_status", params: StatusParams(
                p_request_id: requestId.uuidString,
                p_status: status.rawValue
            ))
            .execute()

        if status != .open {
            openRequests.removeAll { $0.id == requestId }
        }
    }

    // MARK: - Realtime

    func subscribeToRealtime() {
        guard realtimeChannel == nil else { return }
        let channel = supabase.channel("help-requests")
        realtimeChannel = channel

        Task {
            await channel.on(
                "postgres_changes",
                filter: ChannelFilter(
                    event: "*",
                    schema: "public",
                    table: "help_requests"
                )
            ) { [weak self] _ in
                guard let self else { return }
                Task { @MainActor in
                    await self.fetchOpenRequests()
                }
            }
            .subscribe()
        }
    }

    func unsubscribeFromRealtime() {
        Task {
            if let channel = realtimeChannel {
                await supabase.removeChannel(channel)
                realtimeChannel = nil
            }
        }
    }

    // MARK: - helpTargeting()
    // Mirrors lib/helpRequests.ts helpTargeting().
    // Returns event IDs whose ±grace-day window includes today.
    // Seed events only — Family Fest uses its configured dates.

    func helpTargeting() -> [String] {
        let cal = Calendar.current
        let today = cal.startOfDay(for: .now)
        let grace = Self.presenceGraceDays

        let isoFormatter: DateFormatter = {
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd"
            f.timeZone = TimeZone(identifier: "America/Chicago")
            f.locale = Locale(identifier: "en_US_POSIX")
            return f
        }()

        func dayOffset(_ date: Date, by days: Int) -> Date {
            cal.date(byAdding: .day, value: days, to: date) ?? date
        }

        var matchingIds: [String] = []

        for event in ResortEvent.seedEvents {
            guard let start = isoFormatter.date(from: event.startDate) else { continue }
            let end = event.endDate.flatMap { isoFormatter.date(from: $0) } ?? start

            let windowStart = dayOffset(start, by: -grace)
            let windowEnd   = dayOffset(end,   by: +grace)

            if today >= windowStart && today <= windowEnd {
                matchingIds.append(event.id)
            }
        }

        return matchingIds
    }
}
