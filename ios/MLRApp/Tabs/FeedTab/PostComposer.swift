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
            allProfiles = (try? await env.postsService.fetchMemberList()) ?? []
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
                    AvatarView(
                        url: env.currentProfile?.avatarUrl,
                        name: env.currentProfile?.name ?? "",
                        size: 40
                    )
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

        // Upload image if attached
        if let image = selectedImage {
            isUploading = true
            do {
                imageUrl = try await env.mediaService.uploadPostImage(
                    image: image,
                    userId: profile.id,
                    onProgress: { progress in
                        self.uploadProgress = progress
                    }
                )
            } catch {
                errorMessage = "Couldn't upload image. Please try again."
                isUploading = false
                isPosting = false
                return
            }
            isUploading = false
        }

        // Create post
        do {
            try await env.postsService.createPost(
                authorId: profile.id,
                authorName: profile.name,
                text: text.trimmingCharacters(in: .whitespacesAndNewlines),
                imageUrl: imageUrl
            )
            dismiss()
        } catch {
            errorMessage = "Couldn't publish your post. Please try again."
        }

        isPosting = false
    }

    // MARK: - @mention detection

    private func detectMentionTrigger(in value: String) {
        // Find the last @word before the cursor
        let words = value.components(separatedBy: " ")
        if let last = words.last, last.hasPrefix("@") {
            mentionQuery = String(last.dropFirst())
            showMentionSuggestions = !mentionQuery.isEmpty
        } else {
            mentionQuery = ""
            showMentionSuggestions = false
        }
    }

    private func insertMention(_ profile: Profile) {
        // Replace the trailing @query with @FirstName
        let firstName = profile.name.components(separatedBy: " ").first ?? profile.name
        let words = text.components(separatedBy: " ")
        var updated = words.dropLast() + ["@\(firstName) "]
        text = updated.joined(separator: " ")
        showMentionSuggestions = false
        mentionQuery = ""
    }
}

// MentionAutocomplete is defined in Shared/Components/MentionText.swift.
