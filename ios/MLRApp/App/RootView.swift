import SwiftUI

// MARK: - Root View
// Houses the TabView and handles deep-link navigation.

struct RootView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var selectedTab: Tab = .home
    @State private var showSplash = true

    var body: some View {
        ZStack {
            MainTabView(selectedTab: $selectedTab)
                .opacity(showSplash ? 0 : 1)

            if showSplash {
                SplashView {
                    withAnimation(.easeOut(duration: 0.3)) {
                        showSplash = false
                    }
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .notificationTapped)) { note in
            handleNotificationTap(note.userInfo)
        }
    }

    private func handleNotificationTap(_ info: [AnyHashable: Any]?) {
        guard let type = info?["target_type"] as? String else { return }
        switch type {
        case "post":            selectedTab = .feed
        case "event":           selectedTab = .home
        case "notification":    selectedTab = .activity
        case "committee_chat":  selectedTab = .home
        default:                selectedTab = .home
        }
    }
}

// MARK: - Tab enum

enum Tab: String, CaseIterable {
    case home, feed, fest, activity, profile
}

// MARK: - Main Tab View

struct MainTabView: View {
    @Binding var selectedTab: Tab
    @Environment(AppEnvironment.self) private var env

    private var unreadCount: Int {
        env.notificationsService.unreadCount
    }

    private var festSeason: FestSeason {
        FestSeason.current()
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView()
                .tabItem { Label("Home", systemImage: "house.fill") }
                .tag(Tab.home)

            PostsView()
                .tabItem { Label("Feed", systemImage: "rectangle.stack.fill") }
                .tag(Tab.feed)

            FestOverviewView()
                .tabItem {
                    Label {
                        Text("Family Fest")
                    } icon: {
                        Image(systemName: "star.fill")
                    }
                }
                .tag(Tab.fest)
                .badge(festSeason.isLive || festSeason.isWrap ? "●" : nil)

            NotificationsView()
                .tabItem { Label("Activity", systemImage: "bell.fill") }
                .tag(Tab.activity)
                .badge(unreadCount > 0 ? unreadCount : nil)

            ProfileView()
                .tabItem { Label("Profile", systemImage: "person.fill") }
                .tag(Tab.profile)
        }
        .tint(Color.mlrPrimary)
        .task {
            if env.isSignedIn {
                await env.notificationsService.fetchUnreadCount(userId: env.currentProfile?.id)
            }
        }
    }
}

// MARK: - Splash View

struct SplashView: View {
    let onComplete: () -> Void
    @State private var scale: CGFloat = 0.7
    @State private var opacity: Double = 0

    var body: some View {
        ZStack {
            Color.white.ignoresSafeArea()

            Image("brand-logo-green")
                .resizable()
                .scaledToFit()
                .frame(width: 140)
                .scaleEffect(scale)
                .opacity(opacity)
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.75)) {
                scale = 1
                opacity = 1
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                withAnimation(.easeIn(duration: 0.25)) {
                    opacity = 0
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    onComplete()
                }
            }
        }
        // Respect reduce motion — skip animation
        .accessibilityReduceMotion(true) {
            self.modifier(ImmediateSplashModifier(onComplete: onComplete))
        }
    }
}

private struct ImmediateSplashModifier: ViewModifier {
    let onComplete: () -> Void
    func body(content: Content) -> some View {
        Color.clear.onAppear { onComplete() }
    }
}

// MARK: - AccessibilityReduceMotion helper

private extension View {
    @ViewBuilder
    func accessibilityReduceMotion(_ enabled: Bool, @ViewBuilder replacement: () -> some View) -> some View {
        if UIAccessibility.isReduceMotionEnabled && enabled {
            replacement()
        } else {
            self
        }
    }
}
