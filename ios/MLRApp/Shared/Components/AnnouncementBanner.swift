import SwiftUI

// MARK: - AnnouncementBanner
// Mirrors web app's components/AnnouncementBanner.tsx.
// Reads announcements from seed data + Supabase `announcements` table,
// filters expired ones, and renders dismissible banners at the top of Home.
//
// Usage: place at the top of HomeView's scroll content:
//   AnnouncementBannerStack()

// MARK: - Banner Stack (the public entry point)

/// Renders all active, non-dismissed, non-expired announcements in a VStack.
/// Place at the top of the Home scroll view.
struct AnnouncementBannerStack: View {
    @Environment(AppEnvironment.self) private var env
    @State private var dbAnnouncements: [Announcement] = []
    @State private var isLoading = true

    private var visible: [Announcement] {
        let all = Announcement.seed + dbAnnouncements
        return all.filter { announcement in
            !announcement.isExpired &&
            !env.dismissedAnnouncementIds.contains(announcement.id)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(visible) { announcement in
                AnnouncementBannerRow(
                    announcement: announcement,
                    onDismiss: { dismiss(announcement) }
                )
            }
        }
        .task { await loadFromDB() }
    }

    private func dismiss(_ announcement: Announcement) {
        withAnimation(.easeInOut(duration: 0.2)) {
            var ids = env.dismissedAnnouncementIds
            ids.insert(announcement.id)
            env.dismissedAnnouncementIds = ids
        }
    }

    @MainActor
    private func loadFromDB() async {
        guard isSupabaseConfigured else {
            isLoading = false
            return
        }
        do {
            let rows: [Announcement] = try await supabase
                .from("announcements")
                .select("*")
                .order("created_at", ascending: false)
                .execute()
                .value
            dbAnnouncements = rows
        } catch {
            print("[AnnouncementBanner] fetch error: \(error)")
        }
        isLoading = false
    }

    /// True when a real Supabase URL has been configured.
    private var isSupabaseConfigured: Bool {
        let url = ProcessInfo.processInfo.environment["SUPABASE_URL"] ?? ""
        return !url.isEmpty && !url.contains("YOUR_PROJECT_ID")
    }
}

// MARK: - Individual banner row

private struct AnnouncementBannerRow: View {
    let announcement: Announcement
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // Kind indicator dot
            Circle()
                .fill(kindColor)
                .frame(width: 8, height: 8)
                .padding(.top, 5)

            // Text content
            VStack(alignment: .leading, spacing: 2) {
                Text(announcement.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(kindTextColor)

                if let body = announcement.body, !body.isEmpty {
                    Text(body)
                        .font(.system(size: 13))
                        .foregroundStyle(kindTextColor.opacity(0.85))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Dismiss button
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(kindTextColor.opacity(0.6))
                    .padding(6)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(kindBackgroundColor)
        .overlay(
            Rectangle()
                .frame(width: 3)
                .foregroundStyle(kindColor),
            alignment: .leading
        )
    }

    // MARK: Kind colors

    private var kindColor: Color {
        switch announcement.kind {
        case .info:    return Color.mlrPrimary
        case .warning: return Color.mlrWarning
        case .urgent:  return Color.mlrDanger
        case .fest:    return Color.mlrFest
        }
    }

    private var kindTextColor: Color {
        switch announcement.kind {
        case .info:    return Color.mlrPrimary
        case .warning: return Color(hex: "#92400e") // amber-800
        case .urgent:  return Color(hex: "#991b1b") // red-800
        case .fest:    return Color.mlrFest
        }
    }

    private var kindBackgroundColor: Color {
        switch announcement.kind {
        case .info:    return Color.mlrPrimaryLight
        case .warning: return Color(hex: "#fffbeb") // amber-50
        case .urgent:  return Color(hex: "#fef2f2") // red-50
        case .fest:    return Color.mlrFestLight
        }
    }
}

// MARK: - Announcement seed note
// `Announcement.seed` is defined in SeedData.swift (the extension at the bottom
// of that file). This file just reads it — no redeclaration needed here.

// MARK: - Preview

#if DEBUG
struct AnnouncementBanner_Previews: PreviewProvider {
    static let env: AppEnvironment = {
        let e = AppEnvironment()
        return e
    }()

    static var previews: some View {
        VStack(spacing: 0) {
            AnnouncementBannerRow(
                announcement: Announcement(
                    id: "p1",
                    title: "Welcome to Muskellunge Lake Resort",
                    body: "Browse freely — sign in when you're ready to RSVP or chat.",
                    kind: .info,
                    expiresAt: nil,
                    createdAt: nil
                ),
                onDismiss: {}
            )

            AnnouncementBannerRow(
                announcement: Announcement(
                    id: "p2",
                    title: "Family Fest starts July 27!",
                    body: "Pack your bags — five days on the lake.",
                    kind: .fest,
                    expiresAt: nil,
                    createdAt: nil
                ),
                onDismiss: {}
            )

            AnnouncementBannerRow(
                announcement: Announcement(
                    id: "p3",
                    title: "Dock closed for repairs",
                    body: "Expected back by Friday afternoon.",
                    kind: .warning,
                    expiresAt: nil,
                    createdAt: nil
                ),
                onDismiss: {}
            )

            AnnouncementBannerRow(
                announcement: Announcement(
                    id: "p4",
                    title: "Urgent: water main break",
                    body: "Use bottled water until further notice.",
                    kind: .urgent,
                    expiresAt: nil,
                    createdAt: nil
                ),
                onDismiss: {}
            )
        }
        .environment(env)
        .previewDisplayName("AnnouncementBanner kinds")
    }
}
#endif
