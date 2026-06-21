import SwiftUI

// MARK: - CommentsView
// Sheet presenting the comment thread for a post.
// Mirrors the comments sheet in the web app.
//
// Features:
//   • Post recap at top (author, text snippet, image thumbnail)
//   • List of PostComments with MentionText + relative timestamp
//   • Sign-in guard on the comment input box
//   • TextEditor + send button with @mention autocomplete
//   • Report button (⋯) per comment
//   • Realtime subscription for new comments
//   • "Be the first to comment" empty state

struct CommentsView: View {
    let post: Post

    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    @State private var comments: [PostComment] = []
    @State private var isLoading = true
    @State private var commentText = ""
    @State private var isSending = false
    @State private var sendError: String? = nil
    @State private var showSignIn = false
    @State private var mentionQuery = ""
    @State private var showMentionSuggestions = false
    @State private var allProfiles: [Profile] = []

    private let charLimit = 300

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Post recap
                postRecap
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)

                Divider()

                // Comment list
                commentList

                Divider()

                // Input area
                if env.isSignedIn {
                    commentInput
                } else {
                    signInPrompt
                }
            }
            .navigationTitle("Comments")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .sheet(isPresented: $showSignIn) {
            SignInSheet()
        }
        .task {
            await loadComments()
            allProfiles = (try? await env.postsService.fetchMemberList()) ?? []
            startRealtime()
        }
    }

    // MARK: - Post recap

    private var postRecap: some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: post.authorAvatarUrl, name: post.authorName, size: 32)
            VStack(alignment: .leading, spacing: 3) {
                Text(env.isSignedIn ? post.authorName
                     : (post.authorName.components(separatedBy: " ").first ?? post.authorName))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.mlrText)
                if let text = post.text {
                    Text(text)
                        .font(.subheadline)
                        .foregroundStyle(Color.mlrTextMuted)
                        .lineLimit(2)
                }
            }
            Spacer()
            if let imageUrl = post.imageUrl, let url = URL(string: imageUrl) {
                AsyncImage(url: url) { phase in
                    if case .success(let img) = phase {
                        img.resizable().scaledToFill()
                            .frame(width: 44, height: 44)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }

    // MARK: - Comment list

    @ViewBuilder
    private var commentList: some View {
        if isLoading {
            List {
                ForEach(0..<4, id: \.self) { _ in CommentSkeleton() }
            }
            .listStyle(.plain)
        } else if comments.isEmpty {
            VStack(spacing: 12) {
                Spacer()
                Image(systemName: "bubble.left")
                    .font(.system(size: 36))
                    .foregroundStyle(Color.mlrTextSubtle)
                Text("Be the first to comment")
                    .font(.subheadline)
                    .foregroundStyle(Color.mlrTextMuted)
                Spacer()
            }
        } else {
            List {
                ForEach(comments) { comment in
                    CommentRow(
                        comment: comment,
                        isSignedIn: env.isSignedIn,
                        canReport: env.isSignedIn && comment.authorId != env.currentProfile?.id,
                        onReport: {
                            await reportComment(comment)
                        }
                    )
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                }
            }
            .listStyle(.plain)
        }
    }

    // MARK: - Comment input

    @ViewBuilder
    private var commentInput: some View {
        ZStack(alignment: .top) {
            VStack(spacing: 0) {
                // @mention overlay above the input
                if showMentionSuggestions && !mentionQuery.isEmpty {
                    MentionAutocomplete(
                        members: allProfiles,
                        query: mentionQuery,
                        onSelect: { insertMention($0) }
                    )
                    .padding(.horizontal, 8)
                    .padding(.top, 4)
                }

                HStack(alignment: .bottom, spacing: 10) {
                    AvatarView(url: env.currentProfile?.avatarUrl,
                               name: env.currentProfile?.name ?? "",
                               size: 30)

                    ZStack(alignment: .topLeading) {
                        if commentText.isEmpty {
                            Text("Add a comment…")
                                .foregroundStyle(Color.mlrTextSubtle)
                                .font(.subheadline)
                                .padding(.top, 8)
                                .padding(.leading, 4)
                        }
                        TextEditor(text: $commentText)
                            .frame(minHeight: 36, maxHeight: 100)
                            .font(.subheadline)
                            .onChange(of: commentText) { _, val in
                                detectMentionTrigger(in: val)
                            }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.mlrCard)
                    .clipShape(RoundedRectangle(cornerRadius: 18))

                    // Send button
                    Button {
                        Task { await sendComment() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(canSend ? Color.mlrPrimary : Color.mlrTextSubtle)
                    }
                    .disabled(!canSend || isSending)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)

                if let err = sendError {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(Color.mlrDanger)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 6)
                }
            }
            .background(Color.mlrSurface)
        }
    }

    private var signInPrompt: some View {
        HStack {
            Text("Sign in to comment")
                .font(.subheadline)
                .foregroundStyle(Color.mlrTextMuted)
            Spacer()
            Button("Sign in") { showSignIn = true }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.mlrPrimary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Color.mlrSurface)
    }

    // MARK: - Helpers

    private var canSend: Bool {
        !commentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && commentText.count <= charLimit
        && !isSending
    }

    @MainActor
    private func loadComments() async {
        isLoading = true
        comments = (try? await env.postsService.fetchComments(postId: post.id)) ?? []
        isLoading = false
    }

    private func startRealtime() {
        env.postsService.onNewComment = { comment in
            guard comment.postId == post.id else { return }
            Task { @MainActor in
                if !comments.contains(where: { $0.id == comment.id }) {
                    comments.append(comment)
                }
            }
        }
        env.postsService.startCommentRealtime(postId: post.id)
    }

    @MainActor
    private func sendComment() async {
        guard let profile = env.currentProfile, canSend else { return }
        isSending = true
        sendError = nil
        let trimmed = commentText.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let comment = try await env.postsService.createComment(
                postId: post.id,
                authorId: profile.id,
                authorName: profile.name,
                text: trimmed
            )
            comments.append(comment)
            commentText = ""
        } catch {
            sendError = "Couldn't post comment. Please try again."
        }
        isSending = false
    }

    private func reportComment(_ comment: PostComment) async {
        guard let userId = env.currentProfile?.id else { return }
        try? await env.postsService.reportContent(
            reporterId: userId,
            targetType: "post_comment",
            targetId: comment.id
        )
    }

    private func detectMentionTrigger(in value: String) {
        let words = value.components(separatedBy: " ")
        if let last = words.last, last.hasPrefix("@"), last.count > 1 {
            mentionQuery = String(last.dropFirst())
            showMentionSuggestions = true
        } else {
            mentionQuery = ""
            showMentionSuggestions = false
        }
    }

    private func insertMention(_ profile: Profile) {
        let firstName = profile.name.components(separatedBy: " ").first ?? profile.name
        let words = commentText.components(separatedBy: " ")
        let updated = words.dropLast() + ["@\(firstName) "]
        commentText = updated.joined(separator: " ")
        showMentionSuggestions = false
        mentionQuery = ""
    }
}

// MARK: - CommentRow

struct CommentRow: View {
    let comment: PostComment
    let isSignedIn: Bool
    let canReport: Bool
    let onReport: () async -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: comment.authorAvatarUrl, name: comment.authorName, size: 28)

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(displayName)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.mlrText)
                    Text(MLRFormat.relativeTime(comment.createdAt))
                        .font(.caption2)
                        .foregroundStyle(Color.mlrTextMuted)
                    Spacer()
                    if canReport {
                        Menu {
                            Button(role: .destructive) {
                                Task { await onReport() }
                            } label: {
                                Label("Report comment", systemImage: "flag")
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.caption)
                                .foregroundStyle(Color.mlrTextMuted)
                                .padding(6)
                                .contentShape(Rectangle())
                        }
                    }
                }
                MentionText(text: comment.text)
                    .font(.subheadline)
                    .foregroundStyle(Color.mlrText)
            }
        }
    }

    private var displayName: String {
        if !isSignedIn {
            return comment.authorName.components(separatedBy: " ").first ?? comment.authorName
        }
        return comment.authorName
    }
}

// MARK: - CommentSkeleton

struct CommentSkeleton: View {
    @State private var opacity: Double = 0.4

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(Color.mlrCard)
                .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 4).fill(Color.mlrCard).frame(width: 90, height: 11)
                RoundedRectangle(cornerRadius: 4).fill(Color.mlrCard).frame(maxWidth: .infinity).frame(height: 11)
            }
        }
        .padding(.vertical, 4)
        .opacity(opacity)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.85).repeatForever(autoreverses: true)) {
                opacity = 1
            }
        }
    }
}
