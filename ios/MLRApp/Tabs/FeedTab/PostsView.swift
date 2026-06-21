import SwiftUI

// MARK: - PostsView
// The main Feed tab. Mirrors components/PostsView.tsx.
//
// Layout:
//   • Driven by env.postsService.posts (an @Observable array)
//   • Pull-to-refresh (.refreshable)
//   • Floating "new post" pencil button (signed-in only)
//   • SignInWall is not used here — the feed is fully browsable;
//     compose is conditionally shown when signed in
//   • Realtime subscription fires in .task

struct PostsView: View {
    @Environment(AppEnvironment.self) private var env

    @State private var showComposer = false
    @State private var showSignIn = false
    @State private var reactionMap: [UUID: [PostReaction]] = [:]

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                content

                if env.isSignedIn {
                    composeButton
                }
            }
            .navigationTitle("Feed")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    if !env.isSignedIn {
                        Button("Sign in") { showSignIn = true }
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Color.mlrPrimary)
                    }
                }
            }
        }
        .sheet(isPresented: $showComposer, onDismiss: {
            Task { await env.postsService.fetchPosts(userId: env.currentProfile?.id) }
        }) {
            PostComposer()
        }
        .sheet(isPresented: $showSignIn) {
            SignInView()
        }
        .task {
            await env.postsService.fetchPosts(userId: env.currentProfile?.id)
            await fetchReactions(for: env.postsService.posts)
            env.postsService.subscribeToRealtime()
        }
        .onChange(of: env.postsService.posts) { _, newPosts in
            Task { await fetchReactions(for: newPosts) }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if env.postsService.isLoading && env.postsService.posts.isEmpty {
            loadingState
        } else if env.postsService.posts.isEmpty {
            emptyState
        } else {
            feedList
        }
    }

    private var feedList: some View {
        ScrollView {
            LazyVStack(spacing: 1) {
                ForEach(env.postsService.posts) { post in
                    PostCard(
                        post: post,
                        reactions: reactionMap[post.id] ?? [],
                        onReactionToggle: { emoji in
                            await toggleReaction(post: post, emoji: emoji)
                        },
                        onReport: {
                            await reportPost(post)
                        },
                        onAdminRemove: env.isAdmin ? {
                            await adminRemove(post)
                        } : nil
                    )
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)

                    Divider()
                        .padding(.horizontal, 16)
                }
            }
            .padding(.top, 8)
        }
        .refreshable {
            await env.postsService.fetchPosts(userId: env.currentProfile?.id)
        }
    }

    private var loadingState: some View {
        ScrollView {
            LazyVStack(spacing: 1) {
                ForEach(0..<5, id: \.self) { _ in
                    PostCardSkeleton()
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                    Divider().padding(.horizontal, 16)
                }
            }
            .padding(.top, 8)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "rectangle.stack")
                .font(.system(size: 44))
                .foregroundStyle(Color.mlrTextSubtle)
            Text("Nothing here yet")
                .font(.headline)
                .foregroundStyle(Color.mlrText)
            Text("Be the first to share something with the family.")
                .font(.subheadline)
                .foregroundStyle(Color.mlrTextMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            if env.isSignedIn {
                Button {
                    showComposer = true
                } label: {
                    Text("Write a post")
                        .primaryButton()
                }
                .padding(.horizontal, 40)
            }
            Spacer()
        }
    }

    private var composeButton: some View {
        Button {
            showComposer = true
        } label: {
            Image(systemName: "square.and.pencil")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(Color.mlrPrimary)
                .clipShape(Circle())
                .shadow(color: Color.mlrPrimary.opacity(0.35), radius: 8, x: 0, y: 4)
        }
        .padding(.trailing, 20)
        .padding(.bottom, 24)
    }

    // MARK: - Reactions

    @MainActor
    private func fetchReactions(for posts: [Post]) async {
        for post in posts {
            if let reactions = try? await env.postsService.fetchReactions(postId: post.id) {
                reactionMap[post.id] = reactions
            }
        }
    }

    private func toggleReaction(post: Post, emoji: String) async {
        guard let userId = env.currentProfile?.id else { return }
        let existing = reactionMap[post.id] ?? []
        let myReaction = existing.first(where: { $0.userId == userId && $0.emoji == emoji })

        // Optimistic update
        if let r = myReaction {
            reactionMap[post.id] = existing.filter { $0.id != r.id }
        } else {
            let optimistic = PostReaction(
                id: UUID(), postId: post.id, userId: userId,
                emoji: emoji, createdAt: .now
            )
            reactionMap[post.id] = existing + [optimistic]
        }

        do {
            if myReaction != nil {
                try await env.postsService.removeReaction(postId: post.id, emoji: emoji, userId: userId)
            } else {
                try await env.postsService.addReaction(postId: post.id, emoji: emoji, userId: userId)
            }
            // Refetch authoritative state
            if let fresh = try? await env.postsService.fetchReactions(postId: post.id) {
                reactionMap[post.id] = fresh
            }
        } catch {
            // Roll back optimistic update
            if let fresh = try? await env.postsService.fetchReactions(postId: post.id) {
                reactionMap[post.id] = fresh
            }
        }
    }

    private func reportPost(_ post: Post) async {
        try? await env.postsService.reportContent(
            targetType: "post",
            targetId: post.id,
            reason: nil
        )
    }

    private func adminRemove(_ post: Post) async {
        // The web app uses set_content_status RPC; the iOS PostsService doesn't expose it yet.
        // Call the Supabase RPC directly until PostsService gains this method.
        struct StatusParams: Encodable {
            let p_target_type: String
            let p_target_id: String
            let p_status: String
        }
        try? await supabase
            .rpc("set_content_status", params: StatusParams(
                p_target_type: "post",
                p_target_id: post.id.uuidString,
                p_status: "hidden"
            ))
            .execute()
        await env.postsService.fetchPosts(userId: env.currentProfile?.id)
    }
}
