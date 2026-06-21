import Foundation

// MARK: - Committee

struct Committee: Codable, Identifiable, Equatable {
    let id: UUID
    var slug: String
    var name: String
    var description: String?
    var emoji: String?
    var isPrivate: Bool
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, slug, name, description, emoji
        case isPrivate = "is_private"
        case createdAt = "created_at"
    }
}

// MARK: - Committee Member

struct CommitteeMember: Codable, Identifiable, Equatable {
    let id: UUID
    let committeeId: UUID
    let userId: UUID
    var role: CommitteeRole
    var joinedAt: Date?
    var profile: Profile?

    enum CodingKeys: String, CodingKey {
        case id
        case committeeId = "committee_id"
        case userId = "user_id"
        case role
        case joinedAt = "joined_at"
        case profile = "profiles"
    }
}

enum CommitteeRole: String, Codable {
    case member
    case lead
    case admin
}

// MARK: - Join Request

struct CommitteeJoinRequest: Codable, Identifiable, Equatable {
    let id: UUID
    let committeeId: UUID
    let userId: UUID
    var status: JoinRequestStatus
    var note: String?
    var createdAt: Date?
    var profile: Profile?

    enum CodingKeys: String, CodingKey {
        case id
        case committeeId = "committee_id"
        case userId = "user_id"
        case status
        case note
        case createdAt = "created_at"
        case profile = "profiles"
    }
}

enum JoinRequestStatus: String, Codable {
    case pending
    case approved
    case declined
}

// MARK: - Committee Chat Message

struct CommitteeChatMessage: Codable, Identifiable, Equatable {
    let id: UUID
    let committeeId: UUID
    let authorId: UUID
    var authorName: String
    var authorAvatarUrl: String?
    var text: String
    var editedAt: Date?
    var deletedAt: Date?
    var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case committeeId = "committee_id"
        case authorId = "author_id"
        case authorName = "author_name"
        case authorAvatarUrl = "author_avatar_url"
        case text
        case editedAt = "edited_at"
        case deletedAt = "deleted_at"
        case createdAt = "created_at"
    }

    var isDeleted: Bool { deletedAt != nil }
    var isEdited: Bool { editedAt != nil }

    func canEdit(userId: UUID, isAdmin: Bool, now: Date = .now) -> Bool {
        guard !isDeleted else { return false }
        if isAdmin { return true }
        guard authorId == userId else { return false }
        return now.timeIntervalSince(createdAt) < 86400
    }

    func canDelete(userId: UUID, isAdmin: Bool, now: Date = .now) -> Bool {
        canEdit(userId: userId, isAdmin: isAdmin, now: now)
    }
}
