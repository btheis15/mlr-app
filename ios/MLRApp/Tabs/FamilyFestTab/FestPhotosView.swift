import SwiftUI
import PhotosUI

// MARK: - FestPhoto Model

struct FestPhoto: Identifiable {
    let id: String
    let url: URL
    let uploadedBy: String
    let createdAt: Date
}

// MARK: - FestPhotosView

struct FestPhotosView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var photos: [FestPhoto] = []
    @State private var isLoading = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var isUploading = false
    @State private var uploadError: String?
    @State private var lightboxPhoto: FestPhoto?
    @State private var showPhotoPicker = false

    private let columns = [
        GridItem(.flexible(), spacing: 2),
        GridItem(.flexible(), spacing: 2)
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {

                // Upload bar
                if env.isSignedIn {
                    uploadBar
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 10)
                }

                if isLoading {
                    ProgressView()
                        .tint(Color.mlrFest)
                        .padding(.top, 40)
                } else if photos.isEmpty {
                    emptyState
                } else {
                    // Photo grid
                    LazyVGrid(columns: columns, spacing: 2) {
                        ForEach(photos) { photo in
                            Button {
                                lightboxPhoto = photo
                            } label: {
                                AsyncImage(url: photo.url) { image in
                                    image
                                        .resizable()
                                        .scaledToFill()
                                } placeholder: {
                                    Color.mlrFest.opacity(0.1)
                                }
                                .frame(height: 180)
                                .clipped()
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .background(Color.mlrFestParchment)
        .refreshable {
            await loadPhotos()
        }
        .task {
            await loadPhotos()
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $selectedPhotoItem, matching: .images)
        .onChange(of: selectedPhotoItem) { _, newItem in
            guard let item = newItem else { return }
            Task { await uploadPhoto(item) }
        }
        .sheet(item: $lightboxPhoto) { photo in
            LightboxView(url: photo.url)
        }
        .alert("Upload Error", isPresented: .constant(uploadError != nil)) {
            Button("OK") { uploadError = nil }
        } message: {
            Text(uploadError ?? "")
        }
    }

    // MARK: - Upload Bar

    private var uploadBar: some View {
        HStack {
            Text("Fest Photos")
                .font(.festSerif(15, weight: .bold))
                .foregroundStyle(Color.mlrFest)

            Spacer()

            if isUploading {
                HStack(spacing: 6) {
                    ProgressView()
                        .tint(Color.mlrFest)
                        .scaleEffect(0.8)
                    Text("Uploading…")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.mlrFest.opacity(0.7))
                }
            } else {
                Button {
                    showPhotoPicker = true
                } label: {
                    Label("Upload", systemImage: "photo.badge.plus")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(Color.mlrFest)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer(minLength: 40)
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 44))
                .foregroundStyle(Color.mlrFest.opacity(0.3))
            Text("No photos yet")
                .font(.festSerif(16, weight: .bold))
                .foregroundStyle(Color.mlrFest.opacity(0.5))
            Text("Be the first to share a memory from the Fest!")
                .font(.system(size: 13))
                .foregroundStyle(Color.mlrFest.opacity(0.4))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer(minLength: 40)
        }
    }

    // MARK: - Data Loading

    @MainActor
    private func loadPhotos() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let rows: [[String: String]] = try await supabase
                .storage
                .from("fest-photos")
                .list(path: "2026")
            photos = rows.compactMap { row in
                guard let name = row["name"],
                      let urlStr = row["url"] ?? buildStorageUrl(name: name),
                      let url = URL(string: urlStr)
                else { return nil }
                return FestPhoto(
                    id: name,
                    url: url,
                    uploadedBy: "",
                    createdAt: Date()
                )
            }
        } catch {
            // Graceful degradation — photos bucket may not exist yet
            photos = []
        }
    }

    @MainActor
    private func uploadPhoto(_ item: PhotosPickerItem) async {
        isUploading = true
        defer {
            isUploading = false
            selectedPhotoItem = nil
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            let filename = "2026/\(UUID().uuidString).jpg"
            _ = try await supabase
                .storage
                .from("fest-photos")
                .upload(filename, data: data, options: .init(contentType: "image/jpeg", upsert: false))
            await loadPhotos()
        } catch {
            uploadError = error.localizedDescription
        }
    }

    private func buildStorageUrl(name: String) -> String? {
        // Fallback: build the public URL from the Supabase project URL
        guard let base = ProcessInfo.processInfo.environment["SUPABASE_URL"] else { return nil }
        return "\(base)/storage/v1/object/public/fest-photos/2026/\(name)"
    }
}

// MARK: - Lightbox View

struct LightboxView: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var offset: CGSize = .zero

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()

            AsyncImage(url: url) { image in
                image
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(scale)
                    .offset(offset)
                    .gesture(
                        MagnificationGesture()
                            .onChanged { value in scale = max(1, value) }
                            .onEnded { _ in
                                withAnimation(.spring()) { scale = max(1, scale) }
                            }
                    )
                    .simultaneousGesture(
                        DragGesture()
                            .onChanged { value in
                                if scale > 1 { offset = value.translation }
                            }
                            .onEnded { _ in
                                if scale <= 1 { withAnimation(.spring()) { offset = .zero } }
                            }
                    )
            } placeholder: {
                ProgressView().tint(.white)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.white.opacity(0.85))
                    .padding(20)
            }
        }
    }
}
