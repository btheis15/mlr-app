import Foundation
import Supabase

// MARK: - NotificationsService

@Observable
@MainActor
final class NotificationsService {
    var notifications: [AppNotification] = []
    var unreadCount: Int = 0
    var isLoading: Bool = false
    var error: String? = nil

    private var realtimeChannel: RealtimeChannelV2? = nil

    // MARK: - Fetch

    func fetchNotifications(userId: UUID) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let rows: [AppNotification] = try await supabase
                .from("notifications")
                .select("*")
                .eq("user_id", value: userId.uuidString)
                .order("created_at", ascending: false)
                .limit(100)
                .execute()
                .value
            notifications = rows
            updateUnreadCount()
        } catch {
            self.error = "Couldn't load notifications."
            print("[NotificationsService] fetchNotifications error: \(error)")
        }
    }

    func fetchUnreadCount(userId: UUID) async {
        struct CountRow: Decodable { let count: Int }
        do {
            // Count rows where seen_at IS NULL and not expired
            let rows: [CountRow] = try await supabase
                .from("notifications")
                .select("count:id.count()")
                .eq("user_id", value: userId.uuidString)
                .is("seen_at", value: "null")
                .or("expires_at.is.null,expires_at.gt.\(iso8601Now())")
                .execute()
                .value
            unreadCount = rows.first?.count ?? 0
        } catch {
            print("[NotificationsService] fetchUnreadCount error: \(error)")
        }
    }

    // MARK: - Mark seen / read

    /// Mark all unseen notifications seen — clears the badge.
    func markAllSeen(userId: UUID) async {
        do {
            struct MarkSeenParams: Encodable { let p_user_id: String }
            try await supabase
                .rpc("mark_notifications_seen", params: MarkSeenParams(p_user_id: userId.uuidString))
                .execute()

            // Optimistic update
            let now = Date.now
            notifications = notifications.map { n in
                var updated = n
                if updated.seenAt == nil { updated.seenAt = now }
                return updated
            }
            unreadCount = 0
        } catch {
            print("[NotificationsService] markAllSeen error: \(error)")
        }
    }

    /// Mark an individual notification read — removes bold styling.
    func markRead(notificationId: UUID) async {
        do {
            struct MarkReadParams: Encodable { let p_notification_id: String }
            try await supabase
                .rpc("mark_notification_read", params: MarkReadParams(p_notification_id: notificationId.uuidString))
                .execute()

            // Optimistic update
            let now = Date.now
            if let idx = notifications.firstIndex(where: { $0.id == notificationId }) {
                notifications[idx].readAt = now
            }
        } catch {
            print("[NotificationsService] markRead error: \(error)")
        }
    }

    // MARK: - Admin broadcast

    func sendBroadcast(
        title: String,
        body: String?,
        audience: BroadcastAudience,
        mirrorBanner: Bool
    ) async throws {
        struct BroadcastParams: Encodable {
            let p_title: String
            let p_body: String?
            let p_audience: String
            let p_mirror_banner: Bool
        }
        try await supabase
            .rpc("send_broadcast_notification", params: BroadcastParams(
                p_title: title,
                p_body: body,
                p_audience: audience.rawValue,
                p_mirror_banner: mirrorBanner
            ))
            .execute()
    }

    // MARK: - Realtime

    func subscribeToRealtime(userId: UUID) {
        guard realtimeChannel == nil else { return }
        let channel = supabase.channel("notifications-\(userId.uuidString)")
        realtimeChannel = channel

        Task {
            await channel.on(
                "postgres_changes",
                filter: ChannelFilter(
                    event: "INSERT",
                    schema: "public",
                    table: "notifications",
                    filter: "user_id=eq.\(userId.uuidString)"
                )
            ) { [weak self] message in
                guard let self else { return }
                Task { @MainActor in
                    // Decode the new row and prepend it
                    if let newNotif = self.decodeNotification(from: message.record) {
                        self.notifications.insert(newNotif, at: 0)
                        if newNotif.countsForBadge {
                            self.unreadCount += 1
                        }
                    }
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

    // MARK: - Private helpers

    private func updateUnreadCount() {
        unreadCount = notifications.filter(\.countsForBadge).count
    }

    private func decodeNotification(from record: [String: AnyJSON]?) -> AppNotification? {
        guard let record else { return nil }
        guard
            let idStr    = record["id"]?.stringValue,
            let id       = UUID(uuidString: idStr),
            let uidStr   = record["user_id"]?.stringValue,
            let userId   = UUID(uuidString: uidStr),
            let kindRaw  = record["kind"]?.stringValue,
            let kind     = NotifType(rawValue: kindRaw),
            let title    = record["title"]?.stringValue,
            let createdStr = record["created_at"]?.stringValue
        else { return nil }

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let createdAt = iso.date(from: createdStr) else { return nil }

        return AppNotification(
            id: id,
            userId: userId,
            kind: kind,
            title: title,
            body: record["body"]?.stringValue,
            targetType: record["target_type"]?.stringValue,
            targetId: record["target_id"]?.stringValue,
            actorName: record["actor_name"]?.stringValue,
            actorAvatarUrl: record["actor_avatar_url"]?.stringValue,
            seenAt: nil,
            readAt: nil,
            expiresAt: record["expires_at"].flatMap { $0.stringValue.flatMap { iso.date(from: $0) } },
            createdAt: createdAt
        )
    }

    private func iso8601Now() -> String {
        ISO8601DateFormatter().string(from: .now)
    }
}

// MARK: - Broadcast audience

enum BroadcastAudience: String {
    case everyone = "everyone"
    case betaTesters = "beta_testers"
    case admins
}
