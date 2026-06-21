import Foundation
import Supabase

// MARK: - PostsService

@Observable
@MainActor
final class PostsService {
    var posts: [Post] = []
    var isLoading: Bool = false
    var error: String? = nil

    private var realtimeChannel: RealtimeChannelV2? = nil

    // MARK: - Fetch

    /// Load posts joined with author name/avatar.
    /// Returns visible posts, plus the current user's own pending/hidden posts.
    func fetchPosts(userId: UUID?) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let query = supabase
                .from("posts")
                .select("""
                    id, author_id, text, image_url, status, created_at, updated_at,
                    profiles!author_id(name, avatar_url)
                """)
                .order("created_at", ascending: false)

            // RLS handles filtering: visible to all, or author sees their own
            let rows: [PostRow] = try await query.execute().value
            posts = rows.map(\.toPost)
        } catch {
            self.error = "Couldn't load posts."
            print("[PostsService] fetchPosts error: \(error)")
        }
    }

    // MARK: - Create

    func createPost(text: String?, imageUrl: String?, authorId: UUID) async throws {
        var params: [String: AnyJSON] = [
            "author_id": .string(authorId.uuidString),
            "status":    .string("visible")
        ]
        if let text, !text.isEmpty { params["text"] = .string(text) }
        if let imageUrl             { params["image_url"] = .string(imageUrl) }

        let post: Post = try await supabase
            .from("posts")
            .insert(params)
            .select("""
                id, author_id, text, image_url, status, created_at, updated_at,
                profiles!author_id(name, avatar_url)
            """)
            .single()
            .execute()
            .value
        posts.insert(post, at: 0)
    }

    // MARK: - Comments

    func fetchComments(postId: UUID) async throws -> [PostComment] {
        let comments: [PostComment] = try await supabase
            .from("post_comments")
            .select("""
                id, post_id, author_id, text, status, created_at,
                profiles!author_id(name, avatar_url)
            """)
            .eq("post_id", value: postId.uuidString)
            .order("created_at", ascending: true)
            .execute()
            .value
        return comments
    }

    func addComment(postId: UUID, text: String, authorId: UUID) async throws -> PostComment {
        let params: [String: AnyJSON] = [
            "post_id":   .string(postId.uuidString),
            "author_id": .string(authorId.uuidString),
            "text":      .string(text),
            "status":    .string("visible")
        ]
        let comment: PostComment = try await supabase
            .from("post_comments")
            .insert(params)
            .select("""
                id, post_id, author_id, text, status, created_at,
                profiles!author_id(name, avatar_url)
            """)
            .single()
            .execute()
            .value
        return comment
    }

    // MARK: - Reactions

    func addReaction(postId: UUID, emoji: String, userId: UUID) async throws {
        let params: [String: AnyJSON] = [
            "post_id": .string(postId.uuidString),
            "user_id": .string(userId.uuidString),
            "emoji":   .string(emoji)
        ]
        try await supabase
            .from("post_reactions")
            .upsert(params, onConflict: "post_id,user_id,emoji")
            .execute()
    }

    func removeReaction(postId: UUID, emoji: String, userId: UUID) async throws {
        try await supabase
            .from("post_reactions")
            .delete()
            .eq("post_id", value: postId.uuidString)
            .eq("user_id", value: userId.uuidString)
            .eq("emoji", value: emoji)
            .execute()
    }

    func fetchReactions(postId: UUID) async throws -> [PostReaction] {
        let reactions: [PostReaction] = try await supabase
            .from("post_reactions")
            .select("*")
            .eq("post_id", value: postId.uuidString)
            .execute()
            .value
        return reactions
    }

    // MARK: - Reporting

    func reportContent(targetType: String, targetId: UUID, reason: String?) async throws {
        struct ReportParams: Encodable {
            let target_type: String
            let target_id: String
            let reason: String?
        }
        try await supabase
            .rpc("report_content", params: ReportParams(
                target_type: targetType,
                target_id: targetId.uuidString,
                reason: reason
            ))
            .execute()
    }

    // MARK: - Realtime

    func subscribeToRealtime() {
        guard realtimeChannel == nil else { return }
        let channel = supabase.channel("posts-feed")
        realtimeChannel = channel

        Task {
            await channel.on(
                "postgres_changes",
                filter: ChannelFilter(
                    event: "INSERT",
                    schema: "public",
                    table: "posts"
                )
            ) { [weak self] message in
                guard let self else { return }
                Task { @MainActor in
                    // Re-fetch the new post with joined author info
                    if let record = message.record,
                       let idStr = record["id"]?.stringValue,
                       let id = UUID(uuidString: idStr) {
                        if let post: Post = try? await supabase
                            .from("posts")
                            .select("""
                                id, author_id, text, image_url, status, created_at, updated_at,
                                profiles!author_id(name, avatar_url)
                            """)
                            .eq("id", value: id.uuidString)
                            .single()
                            .execute()
                            .value
                        {
                            // Avoid duplicates (our own insert already appended it)
                            if !self.posts.contains(where: { $0.id == post.id }) {
                                self.posts.insert(post, at: 0)
                            }
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
}

// MARK: - Row shape for the joined select

private struct PostRow: Decodable {
    let id: UUID
    let authorId: UUID
    let text: String?
    let imageUrl: String?
    let status: ContentStatus
    let createdAt: Date
    let updatedAt: Date?
    let profiles: AuthorInfo?

    enum CodingKeys: String, CodingKey {
        case id
        case authorId = "author_id"
        case text
        case imageUrl = "image_url"
        case status
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case profiles
    }

    struct AuthorInfo: Decodable {
        let name: String
        let avatarUrl: String?
        enum CodingKeys: String, CodingKey {
            case name
            case avatarUrl = "avatar_url"
        }
    }

    var toPost: Post {
        Post(
            id: id,
            authorId: authorId,
            authorName: profiles?.name ?? "Member",
            authorAvatarUrl: profiles?.avatarUrl,
            text: text,
            imageUrl: imageUrl,
            status: status,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}
