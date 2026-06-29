import Foundation
import Supabase

// MARK: - Supabase credentials
// ─────────────────────────────────────────────────────────────────────────────
// Paste your project values below. Both are client-safe public values — the
// key is designed to ship in apps; RLS gates all data access.
//
// Find them at: supabase.com → your project → Project Settings → API
//   • Project URL       → url below
//   • anon/public key (eyJ…) OR publishable key (sb_publishable_…) → apiKey
//
// Same values as NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// in the web app's Vercel environment variables.
// ─────────────────────────────────────────────────────────────────────────────
private enum SupabaseConfig {
    static let url    = "https://vrksrpzlslrcjvbzchfg.supabase.co"
    static let apiKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZya3NycHpsc2xyY2p2YnpjaGZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTc0NzIsImV4cCI6MjA5NTg5MzQ3Mn0.0zH2vAJyA2t8B9LRo_4b5cJ1a_F7X0NO0r1BJhh_bf0"
}

let supabase = SupabaseClient(
    supabaseURL: URL(string: SupabaseConfig.url)!,
    supabaseKey: SupabaseConfig.apiKey
)

// MARK: - App Environment

@Observable
final class AppEnvironment {
    var authService: AuthService
    var postsService: PostsService
    var eventsService: EventsService
    var notificationsService: NotificationsService
    var committeeService: CommitteeService
    var cabinService: CabinService
    var helpService: HelpService
    var pushService: PushService
    var mediaService: MediaService

    // Resolved once per session
    var currentProfile: Profile?
    var isAdmin: Bool { currentProfile?.isAdmin ?? false }
    var isSignedIn: Bool { authService.isSignedIn }

    // Dismissed announcement IDs (persisted in UserDefaults)
    var dismissedAnnouncementIds: Set<String> {
        get {
            let arr = UserDefaults.standard.stringArray(forKey: "dismissed_announcements") ?? []
            return Set(arr)
        }
        set {
            UserDefaults.standard.set(Array(newValue), forKey: "dismissed_announcements")
        }
    }

    // Static hooks so background notification-action handlers (which run without
    // the SwiftUI environment) can reach the live services. Set in init().
    static weak var activeEventsService: EventsService?
    static weak var activeHelpService: HelpService?
    static weak var activeCommitteeService: CommitteeService?

    init() {
        authService          = AuthService()
        postsService         = PostsService()
        eventsService        = EventsService()
        notificationsService = NotificationsService()
        committeeService     = CommitteeService()
        cabinService         = CabinService()
        helpService          = HelpService()
        pushService          = PushService()
        mediaService         = MediaService()

        AppEnvironment.activeEventsService    = eventsService
        AppEnvironment.activeHelpService      = helpService
        AppEnvironment.activeCommitteeService = committeeService
    }

    // Load the signed-in profile after auth
    @MainActor
    func loadProfile() async {
        guard let userId = try? await supabase.auth.session.user.id else {
            currentProfile = nil
            return
        }
        do {
            let profile: Profile = try await supabase
                .from("profiles")
                .select("*")
                .eq("id", value: userId.uuidString)
                .single()
                .execute()
                .value
            currentProfile = profile
        } catch {
            print("[AppEnvironment] loadProfile error: \(error)")
        }
    }

    @MainActor
    func signOut() async {
        await authService.signOut()
        currentProfile = nil
    }
}
