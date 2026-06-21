import Foundation

// MARK: - Notification

struct AppNotification: Codable, Identifiable, Equatable {
    let id: UUID
    let userId: UUID
    var kind: NotifType
    var title: String
    var body: String?
    var targetType: String?
    var targetId: String?
    var actorName: String?
    var actorAvatarUrl: String?
    var seenAt: Date?
    var readAt: Date?
    var expiresAt: Date?
    var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case kind
        case title, body
        case targetType = "target_type"
        case targetId = "target_id"
        case actorName = "actor_name"
        case actorAvatarUrl = "actor_avatar_url"
        case seenAt = "seen_at"
        case readAt = "read_at"
        case expiresAt = "expires_at"
        case createdAt = "created_at"
    }

    var isUnread: Bool { readAt == nil }

    var isExpiredForBadge: Bool {
        guard let expires = expiresAt else { return false }
        return expires < .now
    }

    var countsForBadge: Bool {
        seenAt == nil && !isExpiredForBadge
    }
}

// MARK: - Announcement

struct Announcement: Codable, Identifiable, Equatable {
    let id: String
    var title: String
    var body: String?
    var kind: AnnouncementKind
    var expiresAt: Date?
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, title, body, kind
        case expiresAt = "expires_at"
        case createdAt = "created_at"
    }

    var isExpired: Bool {
        guard let expires = expiresAt else { return false }
        return expires < .now
    }
}

enum AnnouncementKind: String, Codable {
    case info
    case warning
    case urgent
    case fest
}
