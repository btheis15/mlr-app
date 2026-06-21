import SwiftUI

// MARK: - LightboxView
// Full-screen image viewer presented as a sheet.
//
// Features:
//   • Black background fills the safe area
//   • Pinch-to-zoom via MagnificationGesture (clamped 1×–5×)
//   • Swipe-down to dismiss (drag gesture with velocity threshold)
//   • Share button (top-right) → UIActivityViewController
//   • Close button (top-left) → dismiss

struct LightboxView: View {
    let imageUrl: String

    @Environment(\.dismiss) private var dismiss

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var dragOffset: CGSize = .zero
    @State private var loadedImage: UIImage? = nil
    @State private var showShareSheet = false

    private let dismissThreshold: CGFloat = 120
    private let maxScale: CGFloat = 5.0

    var body: some View {
        ZStack {
            // Black scrim
            Color.black.ignoresSafeArea()

            // Image
            imageContent
                .scaleEffect(scale)
                .offset(combinedOffset)
                .gesture(magnificationGesture)
                .gesture(dragGesture)
                .animation(.interactiveSpring(), value: scale)

            // Controls overlay
            VStack {
                HStack {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(.white.opacity(0.85))
                            .padding(16)
                    }

                    Spacer()

                    if loadedImage != nil {
                        Button {
                            showShareSheet = true
                        } label: {
                            Image(systemName: "square.and.arrow.up")
                                .font(.system(size: 22))
                                .foregroundStyle(.white.opacity(0.85))
                                .padding(16)
                        }
                    }
                }
                Spacer()
            }
        }
        .sheet(isPresented: $showShareSheet) {
            if let image = loadedImage {
                ShareSheet(items: [image])
            }
        }
        .statusBarHidden()
        .task {
            await loadImage()
        }
    }

    // MARK: - Image content

    @ViewBuilder
    private var imageContent: some View {
        if let image = loadedImage {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
        } else if let url = URL(string: imageUrl) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .empty:
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(1.5)
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                case .failure:
                    Image(systemName: "photo.slash")
                        .font(.system(size: 44))
                        .foregroundStyle(.white.opacity(0.5))
                @unknown default:
                    EmptyView()
                }
            }
        }
    }

    // MARK: - Gestures

    private var magnificationGesture: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                let proposed = lastScale * value
                scale = min(maxScale, max(1.0, proposed))
            }
            .onEnded { _ in
                lastScale = scale
                // Snap back if below 1×
                if scale < 1.0 {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) {
                        scale = 1.0
                        lastScale = 1.0
                        offset = .zero
                    }
                }
            }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                if scale <= 1.0 {
                    // Swipe-down to dismiss
                    dragOffset = value.translation
                } else {
                    // Pan when zoomed
                    offset = CGSize(
                        width: offset.width + value.translation.width,
                        height: offset.height + value.translation.height
                    )
                }
            }
            .onEnded { value in
                if scale <= 1.0 {
                    // Dismiss if dragged far enough downward
                    let velocity = value.predictedEndTranslation.height
                    if dragOffset.height > dismissThreshold || velocity > dismissThreshold * 1.5 {
                        dismiss()
                    } else {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) {
                            dragOffset = .zero
                        }
                    }
                }
            }
    }

    private var combinedOffset: CGSize {
        CGSize(
            width: offset.width + dragOffset.width,
            height: offset.height + dragOffset.height
        )
    }

    // MARK: - Image loading

    private func loadImage() async {
        guard let url = URL(string: imageUrl) else { return }
        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let image = UIImage(data: data) else { return }
        await MainActor.run { loadedImage = image }
    }
}

// MARK: - ShareSheet
// UIActivityViewController wrapper.

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
