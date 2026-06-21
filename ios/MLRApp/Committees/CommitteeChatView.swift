import SwiftUI

// MARK: - CommitteeChatView
// Realtime committee chat. Own messages right (green), others left (gray).
// Soft-deleted messages render as a "message deleted" tombstone; edited
// messages show an "edited" label. Long-press an editable/deletable message
// for Edit / Delete. @mention autocomplete is scoped to the committee roster.
// Non-members are blocked by SignInWall + a membership notice.

struct CommitteeChatView: View {
    @Environment(AppEnvironment.self) private var env

    let committee: Committee
    let members: [CommitteeMember]

    @State private var messages: [CommitteeChatMessage] = []
    @State private var draft = ""
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var sending = false
    @State private var editingMessage: CommitteeChatMessage?
    @State private var showMentions = false
    @State private var subscribed = false

    private var rosterProfiles: [Profile] {
        members.compactMap(\.profile)
    }

    private var isMember: Bool {
        env.committeeService.myMemberships.contains { $0.committeeId == committee.id }
    }

    var body: some View {
        Group {
            if !env.isSignedIn {
                SignInWall { chatScaffold }
            } else if !isMember && !env.isAdmin {
                notMemberState
            } else {
                chatScaffold
            }
        }
        .navigationTitle(committee.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await initialLoad() }
        .onDisappear {
            env.committeeService.unsubscribeFromMessages(committeeId: committee.id)
        }
    }

    // MARK: - Scaffold

    private var chatScaffold: some View {
        VStack(spacing: 0) {
            messageScroll
            inputBar
        }
        .background(Color(.systemGroupedBackground))
    }

    private var messageScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    if isLoading {
                        ForEach(0..<5, id: \.self) { _ in
                            SkeletonShape(height: 36).padding(.horizontal, 16)
                        }
                    } else if let loadError {
                        Text(loadError)
                            .font(.mlrCaption)
                            .foregroundStyle(Color.mlrDanger)
                            .padding()
                    } else if messages.isEmpty {
                        Text("No messages yet — say hello 👋")
                            .font(.mlrCaption)
                            .foregroundStyle(Color.mlrTextMuted)
                            .padding(.top, 40)
                    } else {
                        ForEach(messages) { message in
                            MessageBubble(
                                message: message,
                                isOwn: message.authorId == env.currentProfile?.id,
                                canEdit: canEdit(message),
                                canDelete: canDelete(message),
                                onEdit: { startEdit(message) },
                                onDelete: { Task { await deleteMessage(message) } }
                            )
                            .id(message.id)
                        }
                    }
                }
                .padding(.vertical, 12)
            }
            .onChange(of: messages.count) {
                if let last = messages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    // MARK: - Input bar

    private var inputBar: some View {
        VStack(spacing: 0) {
            if showMentions {
                MentionAutocomplete(
                    members: rosterProfiles,
                    query: mentionQuery ?? "",
                    onSelect: { profile in
                        draft = applyMention(profile, to: draft)
                        showMentions = false
                    }
                )
                .padding(.horizontal, 12)
                .padding(.bottom, 6)
            }

            if let editingMessage {
                HStack {
                    Label("Editing message", systemImage: "pencil")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.mlrTextMuted)
                    Spacer()
                    Button("Cancel") { cancelEdit() }
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.mlrPrimary)
                }
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .id(editingMessage.id)
            }

            HStack(alignment: .bottom, spacing: 10) {
                TextField("Message…", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Color.mlrSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.mlrBorder, lineWidth: 1))
                    .onChange(of: draft) { _, new in
                        mentionQuery = detectMentionQuery(in: new)
                        showMentions = mentionQuery != nil && !rosterProfiles.isEmpty
                    }

                Button {
                    Task { await send() }
                } label: {
                    if sending {
                        ProgressView().tint(.white)
                            .frame(width: 38, height: 38)
                            .background(Color.mlrPrimary).clipShape(Circle())
                    } else {
                        Image(systemName: editingMessage == nil ? "arrow.up" : "checkmark")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 38, height: 38)
                            .background(canSend ? Color.mlrPrimary : Color.mlrPrimary.opacity(0.4))
                            .clipShape(Circle())
                    }
                }
                .buttonStyle(.plain)
                .disabled(!canSend || sending)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.mlrSurface)
        }
    }

    @State private var mentionQuery: String?

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - Not member

    private var notMemberState: some View {
        ContentUnavailableView {
            Label("Members only", systemImage: "lock.fill")
        } description: {
            Text("Join \(committee.name) to see and post in this chat.")
        }
    }

    // MARK: - Permission helpers

    private func canEdit(_ message: CommitteeChatMessage) -> Bool {
        guard let userId = env.currentProfile?.id else { return false }
        return message.canEdit(userId: userId, isAdmin: env.isAdmin)
    }

    private func canDelete(_ message: CommitteeChatMessage) -> Bool {
        guard let userId = env.currentProfile?.id else { return false }
        return message.canDelete(userId: userId, isAdmin: env.isAdmin)
    }

    // MARK: - Actions

    private func initialLoad() async {
        isLoading = true
        loadError = nil
        do {
            messages = try await env.committeeService.fetchMessages(committeeId: committee.id)
        } catch {
            loadError = "Couldn't load messages."
            print("[CommitteeChat] load error: \(error)")
        }
        isLoading = false

        guard !subscribed else { return }
        subscribed = true
        env.committeeService.subscribeToMessages(
            committeeId: committee.id,
            onInsert: { msg in
                if !messages.contains(where: { $0.id == msg.id }) {
                    messages.append(msg)
                }
            },
            onUpdate: { msg in
                if let idx = messages.firstIndex(where: { $0.id == msg.id }) {
                    messages[idx] = msg
                }
            }
        )
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let userId = env.currentProfile?.id else { return }
        sending = true
        defer { sending = false }

        do {
            if let editing = editingMessage {
                try await env.committeeService.editMessage(messageId: editing.id, text: text)
                if let idx = messages.firstIndex(where: { $0.id == editing.id }) {
                    messages[idx].text = text
                    messages[idx].editedAt = .now
                }
                cancelEdit()
            } else {
                let msg = try await env.committeeService.sendMessage(
                    committeeId: committee.id, text: text, authorId: userId)
                if !messages.contains(where: { $0.id == msg.id }) {
                    messages.append(msg)
                }
                draft = ""
            }
            showMentions = false
        } catch {
            print("[CommitteeChat] send error: \(error)")
        }
    }

    private func startEdit(_ message: CommitteeChatMessage) {
        editingMessage = message
        draft = message.text
    }

    private func cancelEdit() {
        editingMessage = nil
        draft = ""
    }

    private func deleteMessage(_ message: CommitteeChatMessage) async {
        do {
            try await env.committeeService.deleteMessage(messageId: message.id)
            if let idx = messages.firstIndex(where: { $0.id == message.id }) {
                messages[idx].deletedAt = .now
            }
        } catch {
            print("[CommitteeChat] delete error: \(error)")
        }
    }
}

// MARK: - Message Bubble

private struct MessageBubble: View {
    let message: CommitteeChatMessage
    let isOwn: Bool
    let canEdit: Bool
    let canDelete: Bool
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack {
            if isOwn { Spacer(minLength: 50) }
            VStack(alignment: isOwn ? .trailing : .leading, spacing: 3) {
                if !isOwn && !message.isDeleted {
                    Text(message.authorName)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.mlrTextMuted)
                        .padding(.horizontal, 4)
                }
                bubble
            }
            if !isOwn { Spacer(minLength: 50) }
        }
        .padding(.horizontal, 14)
    }

    @ViewBuilder
    private var bubble: some View {
        if message.isDeleted {
            Label("Message deleted", systemImage: "trash")
                .font(.system(size: 13, weight: .regular))
                .italic()
                .foregroundStyle(Color.mlrTextMuted)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.mlrCard.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 14))
        } else {
            VStack(alignment: .trailing, spacing: 2) {
                MentionText(
                    message.text,
                    baseColor: isOwn ? .white : Color.mlrText,
                    mentionColor: isOwn ? Color.mlrPrimaryLight : Color.mlrPrimary
                )
                if message.isEdited {
                    Text("edited")
                        .font(.system(size: 10))
                        .foregroundStyle(isOwn ? Color.white.opacity(0.7) : Color.mlrTextSubtle)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(isOwn ? Color.mlrPrimary : Color.mlrCard)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .contextMenu {
                if canEdit {
                    Button { onEdit() } label: { Label("Edit", systemImage: "pencil") }
                }
                if canDelete {
                    Button(role: .destructive) { onDelete() } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
    }
}
