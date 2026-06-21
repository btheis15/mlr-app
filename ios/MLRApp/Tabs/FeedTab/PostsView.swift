import SwiftUI

// MARK: - PostsView
// The main Feed tab. Mirrors components/PostsView.tsx.
//
// Layout:
//   • ScrollView + LazyVStack of PostCard rows
//   • Pull-to-refresh (.refreshable)
//   • Load-more on scroll to bottom (offset pagination)
//   • Floating "new post" pencil button (signed-in only)
//   • SignInWall guards compose only — the feed is browsable by guests
//   • Realtime subscription fires in .task

struct PostsView: View {
    @Environment(AppEnvironment.self) private var env

    @State private var posts: [Post] = []
    @State private var isLoading = false
    @State private var hasMore = true
    @State private var showComposer = false
    @State private var showSignIn = false
    @State private var reactionMap: [UUID: [PostReaction]] = [:]

    private let pageSize = 20

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                content

                // Floating compose button
                if env.isSignedIn {
                    composeButton
                }
            }
            .navigationTitle("Feed")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    if !env.isSignedIn {
                        Button("Sign in") {
                            showSignIn = true
                        }
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.mlrPrimary)
                    }
                }
            }
        }
        .sheet(isPresented: $showComposer, onDismiss: {
            Task { await refresh() }
        }) {
            PostComposer()
        }
        .sheet(isPresented: $showSignIn) {
            SignInSheet()
        }
        .task {
            await refresh()
            subscribeRealtime()
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if isLoading && posts.isEmpty {
            loadingState
        } else if posts.isEmpty {
            emptyState
        } else {
            feedList
        }
    }

    private var feedList: some View {
        ScrollView {
            LazyVStack(spacing: 1) {
                ForEach(posts) { post in
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

                // Load-more trigger
                if hasMore && !posts.isEmpty {
                    ProgressView()
                        .padding(.vertical, 20)
                        .onAppear {
                            Task { await loadMore() }
                        }
                }
            }
            .padding(.top, 8)
        }
        .refreshable {
            await refresh()
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

    // MARK: - Data

    @MainActor
    private func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let fetched = try await env.postsService.fetchPosts(offset: 0, limit: pageSize)
            posts = fetched
            hasMore = fetched.count == pageSize
            await fetchReactions(for: fetched)
        } catch {
            print("[PostsView] refresh error: \(error)")
        }
    }

    @MainActor
    private func loadMore() async {
        guard hasMore else { return }
        do {
            let fetched = try await env.postsService.fetchPosts(offset: posts.count, limit: pageSize)
            let newPosts = fetched.filter { p in !posts.contains(where: { $0.id == p.id }) }
            posts.append(contentsOf: newPosts)
            hasMore = fetched.count == pageSize
            await fetchReactions(for: newPosts)
        } catch {
            print("[PostsView] loadMore error: \(error)")
        }
    }

    @MainActor
    private func fetchReactions(for batch: [Post]) async {
        for post in batch {
            if let reactions = try? await env.postsService.fetchReactions(postId: post.id) {
                reactionMap[post.id] = reactions
            }
        }
    }

    private func subscribeRealtime() {
        env.postsService.onNewPost = { post in
            Task { @MainActor in
                if !posts.contains(where: { $0.id == post.id }) {
                    posts.insert(post, at: 0)
                }
            }
        }
        env.postsService.startRealtime()
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

        // Commit
        do {
            if myReaction != nil {
                try await env.postsService.removeReaction(postId: post.id, userId: userId, emoji: emoji)
            } else {
                try await env.postsService.addReaction(postId: post.id, userId: userId, emoji: emoji)
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
        guard let userId = env.currentProfile?.id else { return }
        try? await env.postsService.reportContent(
            reporterId: userId,
            targetType: "post",
            targetId: post.id
        )
    }

    private func adminRemove(_ post: Post) async {
        try? await env.postsService.setContentStatus(
            targetType: "post",
            targetId: post.id,
            status: .hidden
        )
        await MainActor.run {
            posts.removeAll { $0.id == post.id }
        }
    }
}
