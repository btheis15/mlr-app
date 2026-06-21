import SwiftUI

// MARK: - Haptics
//
// Light, tasteful haptic feedback for the moments that feel good: RSVP'ing,
// reacting to a post, responding to a help request, casting a shirt vote.

enum Haptics {
    static func tap()      { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func select()   { UISelectionFeedbackGenerator().selectionChanged() }
    static func success()  { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning()  { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    static func error()    { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}

// MARK: - Share sheet
//
// Native share sheet for posts/photos/events — "Share to Messages", AirDrop a Fest
// photo to a cousin, copy an event link, etc.

struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

struct ShareState: Identifiable {
    let id = UUID()
    let items: [Any]
}

extension View {
    func shareSheet(_ state: Binding<ShareState?>) -> some View {
        sheet(item: state) { s in
            ActivityShareSheet(items: s.items).ignoresSafeArea()
        }
    }
}
