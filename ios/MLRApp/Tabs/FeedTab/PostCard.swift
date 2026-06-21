import SwiftUI

// MARK: - PostCard
// A single post in the Feed. Mirrors the PostCard component in the web app.
//
// Layout:
//   avatar + author name (PrivateName masked for guests) + timestamp
//   optional image (AsyncImage + tap → Lightbox)
//   text body with @mention highlights (MentionText from Shared)
//   reaction row (emoji buttons + counts, optimistic toggle)
//   comment count button → CommentsView sheet
//   ⋯ menu → Report / admin Remove

struct PostCard: View {
    let post: Post
    let reactions: [PostReaction]
    let onReactionToggle: (String) async -> Void
    let onReport: () async -> Void
    let onAdminRemove: (() async -> Void)?

    @Environment(AppEnvironment.self) private var env
    @State private var showComments = false
    @State private var showLightbox = false
    @State private var comments: [PostComment] = []
    @State private var commentsLoaded = false

    // Standard reaction emojis
    private let reactionEmojis = ["❤️", "👍", "😂", "🙌", "🎉"]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            authorRow
            if let imageUrl = post.imageUrl {
                postImage(url: imageUrl)
            }
            if let text = post.text, !text.isEmpty {
                MentionText(text)
                    .font(.body)
                    .foregroundStyle(Color.mlrText)
            }
            reactionRow
            actionRow
        }
        .sheet(isPresented: $showComments) {
            CommentsView(post: post)
        }
        .sheet(isPresented: $showLightbox) {
            if let url = post.imageUrl {
                LightboxView(imageUrl: url)
            }
        }
        .task {
            // Load comments eagerly so we can show the comment count without an extra fetch.
            if !commentsLoaded {
                comments = (try? await env.postsService.fetchComments(postId: post.id)) ?? []
                commentsLoaded = true
            }
        }
    }

    // MARK: - Author row

    private var authorRow: some View {
        HStack(alignment: .center, spacing: 10) {
            AvatarView(url: post.authorAvatarUrl, size: .small)

            VStack(alignment: .leading, spacing: 1) {
                // PrivateName: guests see first name only
                Text(displayName)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.mlrText)
                Text(MLRFormat.relativeTime(post.createdAt))
                    .font(.caption)
                    .foregroundStyle(Color.mlrTextMuted)
            }

            Spacer()

            // ⋯ overflow menu
            Menu {
                if env.isSignedIn {
                    Button(role: .destructive) {
                        Task { await onReport() }
                    } label: {
                        Label("Report post", systemImage: "flag")
                    }
                }
                if let adminRemove = onAdminRemove {
                    Divider()
                    Button(role: .destructive) {
                        Task { await adminRemove() }
                    } label: {
                        Label("Remove post", systemImage: "trash")
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16))
                    .foregroundStyle(Color.mlrTextMuted)
                    .padding(8)
                    .contentShape(Rectangle())
            }
        }
    }

    // MARK: - Post image

    @ViewBuilder
    private func postImage(url: String) -> some View {
        if let imageURL = URL(string: url) {
            AsyncImage(url: imageURL) { phase in
                switch phase {
                case .empty:
                    Rectangle()
                        .fill(Color.mlrCard)
                        .frame(maxWidth: .infinity)
                        .frame(height: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(ProgressView())
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity)
                        .frame(height: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .contentShape(RoundedRectangle(cornerRadius: 12))
                        .onTapGesture { showLightbox = true }
                case .failure:
                    Rectangle()
                        .fill(Color.mlrCard)
                        .frame(maxWidth: .infinity)
                        .frame(height: 80)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            Label("Image unavailable", systemImage: "photo.slash")
                                .font(.caption)
                                .foregroundStyle(Color.mlrTextMuted)
                        )
                @unknown default:
                    EmptyView()
                }
            }
        }
    }

    // MARK: - Reaction row

    private var reactionRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(reactionEmojis, id: \.self) { emoji in
                    ReactionButton(
                        emoji: emoji,
                        count: reactionCount(for: emoji),
                        isSelected: isMineReaction(emoji: emoji),
                        onTap: {
                            Task { await onReactionToggle(emoji) }
                        }
                    )
                }
            }
        }
    }

    // MARK: - Action row (comment count + open CommentsView)

    private var actionRow: some View {
        Button {
            showComments = true
        } label: {
            HStack(spacing: 4) {
                Image(systemName: comments.isEmpty ? "bubble.left" : "bubble.left.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(comments.isEmpty ? Color.mlrTextMuted : Color.mlrPrimary)
                Text(commentLabel)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.mlrTextMuted)
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Helpers

    private var displayName: String {
        if !env.isSignedIn {
            return post.authorName.components(separatedBy: " ").first ?? post.authorName
        }
        return post.authorName
    }

    private var commentLabel: String {
        switch comments.count {
        case 0: return "Comment"
        case 1: return "1 comment"
        default: return "\(comments.count) comments"
        }
    }

    private func reactionCount(for emoji: String) -> Int {
        reactions.filter { $0.emoji == emoji }.count
    }

    private func isMineReaction(emoji: String) -> Bool {
        guard let userId = env.currentProfile?.id else { return false }
        return reactions.contains(where: { $0.userId == userId && $0.emoji == emoji })
    }
}

// MARK: - ReactionButton

struct ReactionButton: View {
    let emoji: String
    let count: Int
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 4) {
                Text(emoji)
                    .font(.system(size: 15))
                if count > 0 {
                    Text("\(count)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(isSelected ? Color.mlrPrimary : Color.mlrTextMuted)
                }
            }
            .padding(.horizontal, count > 0 ? 10 : 8)
            .padding(.vertical, 5)
            .background(isSelected ? Color.mlrPrimaryLight : Color.mlrCard)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(
                        isSelected ? Color.mlrPrimary.opacity(0.4) : Color.mlrBorder,
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.12), value: isSelected)
        .animation(.easeInOut(duration: 0.12), value: count)
    }
}

// MARK: - PostCardSkeleton
// Pulsing loading placeholder for a post card.

struct PostCardSkeleton: View {
    @State private var opacity: Double = 0.4

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Circle()
                    .fill(Color.mlrCard)
                    .frame(width: 36, height: 36)
                VStack(alignment: .leading, spacing: 4) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.mlrCard).frame(width: 120, height: 12)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.mlrCard).frame(width: 60, height: 10)
                }
            }
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.mlrCard).frame(maxWidth: .infinity).frame(height: 14)
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.mlrCard).frame(width: 200).frame(height: 14)
        }
        .opacity(opacity)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                opacity = 1.0
            }
        }
    }
}

// AvatarView — Shared/Components/AvatarView.swift
// MentionText — Shared/Components/MentionText.swift
