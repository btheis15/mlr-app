import SwiftUI
import PhotosUI

// MARK: - PostComposer
// Sheet for writing and publishing a new Feed post.
// Mirrors the compose flow in the web app's PostsView.
//
// Features:
//   • TextEditor with 140-char soft limit + remaining count
//   • PhotosPicker image attachment (preview thumbnail + ✕ to remove)
//   • @mention autocomplete overlay (MentionAutocomplete)
//   • Post button (disabled while empty or uploading)
//   • Upload progress indicator
//   • Calls env.postsService.createPost after optional media upload

struct PostComposer: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    @State private var text: String = ""
    @State private var selectedPhoto: PhotosPickerItem? = nil
    @State private var selectedImage: UIImage? = nil
    @State private var isUploading = false
    @State private var uploadProgress: Double = 0
    @State private var isPosting = false
    @State private var errorMessage: String? = nil
    @State private var mentionQuery: String = ""
    @State private var showMentionSuggestions = false
    @State private var allProfiles: [Profile] = []

    private let softLimit = 140

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                VStack(spacing: 0) {
                    composeArea
                    Divider()
                    toolbar
                }

                // @mention autocomplete overlay
                if showMentionSuggestions && !mentionQuery.isEmpty {
                    VStack {
                        Spacer().frame(height: 56) // below the compose header
                        MentionAutocomplete(
                            members: allProfiles,
                            query: mentionQuery,
                            onSelect: { profile in
                                insertMention(profile)
                            }
                        )
                        Spacer()
                    }
                    .zIndex(10)
                }
            }
            .navigationTitle("New Post")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isPosting || isUploading)
                }
                ToolbarItem(placement: .confirmationAction) {
                    postButton
                }
            }
            .interactiveDismissDisabled(isPosting || isUploading)
        }
        .task {
            // Pre-load member list for @mention autocomplete
            allProfiles = (try? await fetchMemberList()) ?? []
        }
        .onChange(of: selectedPhoto) { _, newValue in
            Task { await loadSelectedPhoto(newValue) }
        }
    }

    // MARK: - Compose area

    private var composeArea: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                // Author identity
                HStack(spacing: 10) {
                    AvatarView(url: env.currentProfile?.avatarUrl, size: .medium)
                    Text(env.currentProfile?.name ?? "")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.mlrText)
                }

                // TextEditor
                ZStack(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("What's on your mind?")
                            .foregroundStyle(Color.mlrTextSubtle)
                            .padding(.top, 2)
                    }
                    TextEditor(text: $text)
                        .frame(minHeight: 120)
                        .onChange(of: text) { _, newValue in
                            detectMentionTrigger(in: newValue)
                        }
                }

                // Character count
                HStack {
                    Spacer()
                    Text("\(softLimit - text.count)")
                        .font(.caption)
                        .foregroundStyle(text.count > softLimit
                                         ? Color.mlrDanger
                                         : text.count > softLimit - 20
                                           ? Color.mlrWarning
                                           : Color.mlrTextMuted)
                }

                // Image preview
                if let image = selectedImage {
                    imagePreview(image: image)
                }

                // Upload progress
                if isUploading {
                    VStack(alignment: .leading, spacing: 4) {
                        ProgressView(value: uploadProgress)
                            .tint(Color.mlrPrimary)
                        Text("Uploading image…")
                            .font(.caption)
                            .foregroundStyle(Color.mlrTextMuted)
                    }
                }

                // Error
                if let err = errorMessage {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(Color.mlrDanger)
                }
            }
            .padding(16)
        }
    }

    // MARK: - Image preview

    @ViewBuilder
    private func imagePreview(image: UIImage) -> some View {
        ZStack(alignment: .topTrailing) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxHeight: 220)
                .clipShape(RoundedRectangle(cornerRadius: 12))

            Button {
                selectedImage = nil
                selectedPhoto = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(.white)
                    .shadow(radius: 2)
                    .padding(6)
            }
        }
    }

    // MARK: - Bottom toolbar (photo picker)

    private var toolbar: some View {
        HStack {
            PhotosPicker(selection: $selectedPhoto, matching: .images) {
                Label("Add photo", systemImage: "photo")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.mlrPrimary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
            }
            .disabled(isPosting || isUploading)

            Spacer()
        }
        .padding(.horizontal, 8)
        .background(Color.mlrSurface)
    }

    // MARK: - Post button

    private var postButton: some View {
        Button {
            Task { await post() }
        } label: {
            if isPosting || isUploading {
                ProgressView()
                    .tint(Color.mlrPrimary)
            } else {
                Text("Post")
                    .fontWeight(.semibold)
            }
        }
        .disabled(
            text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || text.count > softLimit
            || isPosting
            || isUploading
        )
    }

    // MARK: - Actions

    private func loadSelectedPhoto(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else { return }
        await MainActor.run { selectedImage = image }
    }

    @MainActor
    private func post() async {
        guard let profile = env.currentProfile else { return }
        isPosting = true
        errorMessage = nil

        var imageUrl: String? = nil

        // Upload image if attached — MediaService.uploadPostImage(image:userId:)
        if let image = selectedImage {
            isUploading = true
            // Simulate progress: Supabase SDK doesn't surface byte-level progress,
            // so set it to 0.5 while the upload is in flight.
            uploadProgress = 0.5
            do {
                imageUrl = try await env.mediaService.uploadPostImage(image: image, userId: profile.id)
                uploadProgress = 1.0
            } catch {
                errorMessage = "Couldn't upload image. Please try again."
                isUploading = false
                isPosting = false
                return
            }
            isUploading = false
        }

        // Create post — PostsService.createPost(text:imageUrl:authorId:)
        do {
            try await env.postsService.createPost(
                text: text.trimmingCharacters(in: .whitespacesAndNewlines),
                imageUrl: imageUrl,
                authorId: profile.id
            )
            dismiss()
        } catch {
            errorMessage = "Couldn't publish your post. Please try again."
        }

        isPosting = false
    }

    // MARK: - @mention detection
    // Uses the shared helpers detectMentionQuery() and applyMention() from MentionText.swift.

    private func detectMentionTrigger(in value: String) {
        mentionQuery = detectMentionQuery(in: value) ?? ""
        showMentionSuggestions = !mentionQuery.isEmpty
    }

    private func insertMention(_ profile: Profile) {
        text = applyMention(profile, to: text)
        mentionQuery = ""
        showMentionSuggestions = false
    }

    // MARK: - Member list for autocomplete

    private func fetchMemberList() async throws -> [Profile] {
        try await supabase
            .from("profiles")
            .select("id, name, avatar_url, is_admin, beta_tester, willing_to_help, intro_seen, email_alerts, push_level, push_types, notif_types, push_prompted, email, created_at")
            .order("name", ascending: true)
            .execute()
            .value
    }
}

// MentionAutocomplete is defined in Shared/Components/MentionText.swift.
