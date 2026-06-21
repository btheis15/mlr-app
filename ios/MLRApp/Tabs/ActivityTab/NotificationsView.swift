import SwiftUI

// MARK: - NotificationsView
// The Activity tab. Shows a grouped, pull-to-refresh notification feed for
// the signed-in user. Non-members see a sign-in wall.

struct NotificationsView: View {
    @Environment(AppEnvironment.self) private var env

    @State private var notifications: [AppNotification] = []
    @State private var isLoading = false
    @State private var error: String? = nil

    // MARK: - Grouping

    private var grouped: [(label: String, items: [AppNotification])] {
        let cal = Calendar.current
        let now = Date.now
        let startOfToday = cal.startOfDay(for: now)
        let startOfWeek  = cal.date(byAdding: .day, value: -7, to: startOfToday)!

        var today: [AppNotification]     = []
        var thisWeek: [AppNotification]  = []
        var earlier: [AppNotification]   = []

        for n in notifications {
            if n.createdAt >= startOfToday {
                today.append(n)
            } else if n.createdAt >= startOfWeek {
                thisWeek.append(n)
            } else {
                earlier.append(n)
            }
        }

        var groups: [(label: String, items: [AppNotification])] = []
        if !today.isEmpty    { groups.append((label: "Today",     items: today)) }
        if !thisWeek.isEmpty { groups.append((label: "This Week", items: thisWeek)) }
        if !earlier.isEmpty  { groups.append((label: "Earlier",   items: earlier)) }
        return groups
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Group {
                if !env.isSignedIn {
                    signInWall
                } else if isLoading && notifications.isEmpty {
                    loadingState
                } else if !isLoading && notifications.isEmpty && error == nil {
                    emptyState
                } else {
                    feedList
                }
            }
            .navigationTitle("Activity")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                if env.isSignedIn && !notifications.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        markAllButton
                    }
                }
            }
        }
        .task {
            await loadAndMarkSeen()
        }
    }

    // MARK: - Feed list

    private var feedList: some View {
        List {
            if let error {
                Section {
                    errorBanner(error)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            }

            ForEach(grouped, id: \.label) { group in
                Section {
                    ForEach(group.items) { notif in
                        NotificationRow(notification: notif)
                            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 0))
                            .listRowBackground(notif.isUnread
                                               ? Color.mlrPrimaryLight.opacity(0.35)
                                               : Color.mlrSurface)
                            .onTapGesture {
                                Task { await handleTap(notif) }
                            }
                    }
                } header: {
                    Text(group.label)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.mlrTextMuted)
                        .textCase(nil)
                }
            }
        }
        .listStyle(.plain)
        .refreshable {
            await loadAndMarkSeen()
        }
    }

    // MARK: - Mark all button

    private var markAllButton: some View {
        Button {
            Task { await markAllRead() }
        } label: {
            Text("Mark all read")
                .font(.system(size: 14))
        }
        .foregroundStyle(Color.mlrPrimary)
        .disabled(!notifications.contains(where: \.isUnread))
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "bell.slash")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(Color.mlrTextSubtle)
            Text("Nothing new yet")
                .font(.headline)
                .foregroundStyle(Color.mlrTextMuted)
            Text("Activity on your posts, mentions, events, and announcements will appear here.")
                .font(.subheadline)
                .foregroundStyle(Color.mlrTextSubtle)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.mlrSurface)
    }

    // MARK: - Loading state

    private var loadingState: some View {
        VStack(spacing: 20) {
            ForEach(0..<6, id: \.self) { _ in
                notifSkeleton
            }
            Spacer()
        }
        .padding(.top, 16)
        .padding(.horizontal, 16)
    }

    private var notifSkeleton: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(Color.mlrCard)
                .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.mlrCard)
                    .frame(height: 14)
                    .frame(maxWidth: .infinity)
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.mlrCard)
                    .frame(height: 12)
                    .frame(maxWidth: 200)
            }
        }
        .shimmering()
    }

    // MARK: - Sign-in wall

    private var signInWall: some View {
        VStack(spacing: 24) {
            Image(systemName: "bell.badge.fill")
                .font(.system(size: 52, weight: .light))
                .foregroundStyle(Color.mlrPrimary.opacity(0.6))

            VStack(spacing: 8) {
                Text("Sign in to see your activity")
                    .font(.title3.bold())
                Text("Comments, mentions, RSVPs, and announcements will appear here.")
                    .font(.subheadline)
                    .foregroundStyle(Color.mlrTextMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            NavigationLink {
                SignInView()
            } label: {
                Text("Sign In")
                    .primaryButton()
            }
            .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.mlrSurface)
    }

    // MARK: - Error banner

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.mlrWarning)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.mlrTextMuted)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.mlrWarning.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Actions

    @MainActor
    private func loadAndMarkSeen() async {
        guard env.isSignedIn, let userId = env.currentProfile?.id else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            // Fetch notifications
            notifications = try await env.notificationsService.fetchNotifications(userId: userId)
            // Mark all as seen (clears badge)
            try await env.notificationsService.markAllSeen(userId: userId)
            await env.notificationsService.fetchUnreadCount(userId: userId)
        } catch {
            self.error = "Couldn't load notifications. Pull to retry."
        }
    }

    @MainActor
    private func markAllRead() async {
        guard let userId = env.currentProfile?.id else { return }
        do {
            try await env.notificationsService.markAllRead(userId: userId)
            // Optimistically update local state
            notifications = notifications.map { n in
                var updated = n
                updated.readAt = .now
                updated.seenAt = updated.seenAt ?? .now
                return updated
            }
            await env.notificationsService.fetchUnreadCount(userId: userId)
        } catch {
            self.error = "Couldn't mark notifications as read."
        }
    }

    @MainActor
    private func handleTap(_ notification: AppNotification) async {
        // Mark this individual notification as read
        if notification.isUnread {
            do {
                try await env.notificationsService.markRead(id: notification.id)
                if let idx = notifications.firstIndex(where: { $0.id == notification.id }) {
                    notifications[idx].readAt = .now
                }
                await env.notificationsService.fetchUnreadCount(userId: env.currentProfile?.id)
            } catch {
                // Non-fatal — still navigate
            }
        }

        // Navigate based on targetType
        // (In the full app, this posts a notification that RootView handles)
        guard let targetType = notification.targetType else { return }
        NotificationCenter.default.post(
            name: .notificationTapped,
            object: nil,
            userInfo: [
                "target_type": targetType,
                "target_id": notification.targetId ?? ""
            ]
        )
    }
}

// MARK: - Shimmer modifier
// Simple shimmer animation for skeleton placeholders.

private extension View {
    func shimmering() -> some View {
        self.modifier(ShimmerModifier())
    }
}

private struct ShimmerModifier: ViewModifier {
    @State private var phase: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .overlay(
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color.white.opacity(0),
                        Color.white.opacity(0.5),
                        Color.white.opacity(0)
                    ]),
                    startPoint: .init(x: phase - 0.3, y: 0),
                    endPoint: .init(x: phase + 0.3, y: 0)
                )
                .blendMode(.screen)
            )
            .onAppear {
                withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) {
                    phase = 1.3
                }
            }
    }
}

// MARK: - NotificationsService extension
// These methods must exist on NotificationsService; stubs shown here to
// document the expected interface used by this view.

extension NotificationsService {
    /// Fetch all notifications for `userId`, newest first.
    func fetchNotifications(userId: UUID) async throws -> [AppNotification] {
        let result: [AppNotification] = try await supabase
            .from("notifications")
            .select("*")
            .eq("user_id", value: userId.uuidString)
            .order("created_at", ascending: false)
            .limit(100)
            .execute()
            .value
        return result
    }

    /// Stamp `seen_at` on all unseen rows (clears badge).
    func markAllSeen(userId: UUID) async throws {
        try await supabase
            .from("notifications")
            .update(["seen_at": ISO8601DateFormatter().string(from: .now)])
            .eq("user_id", value: userId.uuidString)
            .is("seen_at", value: nil)
            .execute()
    }

    /// Stamp `read_at` on all unread rows.
    func markAllRead(userId: UUID) async throws {
        try await supabase
            .from("notifications")
            .update(["read_at": ISO8601DateFormatter().string(from: .now)])
            .eq("user_id", value: userId.uuidString)
            .is("read_at", value: nil)
            .execute()
    }

    /// Stamp `read_at` on a single notification.
    func markRead(id: UUID) async throws {
        try await supabase
            .from("notifications")
            .update(["read_at": ISO8601DateFormatter().string(from: .now)])
            .eq("id", value: id.uuidString)
            .execute()
    }
}

#Preview {
    NotificationsView()
        .environment(AppEnvironment())
}
