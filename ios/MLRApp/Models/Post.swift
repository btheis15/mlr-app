import Foundation

// MARK: - Post

struct Post: Codable, Identifiable, Equatable {
    let id: UUID
    let authorId: UUID
    var authorName: String
    var authorAvatarUrl: String?
    var text: String?
    var imageUrl: String?
    var status: ContentStatus
    var createdAt: Date
    var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case authorId = "author_id"
        case authorName = "author_name"
        case authorAvatarUrl = "author_avatar_url"
        case text
        case imageUrl = "image_url"
        case status
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

// MARK: - Post Comment

struct PostComment: Codable, Identifiable, Equatable {
    let id: UUID
    let postId: UUID
    let authorId: UUID
    var authorName: String
    var authorAvatarUrl: String?
    var text: String
    var status: ContentStatus
    var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case postId = "post_id"
        case authorId = "author_id"
        case authorName = "author_name"
        case authorAvatarUrl = "author_avatar_url"
        case text
        case status
        case createdAt = "created_at"
    }
}

// MARK: - Reaction

struct PostReaction: Codable, Identifiable, Equatable {
    let id: UUID
    let postId: UUID
    let userId: UUID
    var emoji: String
    var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case postId = "post_id"
        case userId = "user_id"
        case emoji
        case createdAt = "created_at"
    }
}

// MARK: - Content Status

enum ContentStatus: String, Codable {
    case visible
    case pending
    case hidden
}

// MARK: - Content Report

struct ContentReport: Codable, Identifiable {
    let id: UUID
    let reporterId: UUID
    let targetType: String
    let targetId: UUID
    var reason: String?
    var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case reporterId = "reporter_id"
        case targetType = "target_type"
        case targetId = "target_id"
        case reason
        case createdAt = "created_at"
    }
}
