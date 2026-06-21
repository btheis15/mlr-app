import Foundation
import Supabase

// MARK: - Supabase client
// Replace the placeholder values with your project's URL and anon key.
// These match the NEXT_PUBLIC_SUPABASE_* env vars in the web app.

let supabase = SupabaseClient(
    supabaseURL: URL(string: ProcessInfo.processInfo.environment["SUPABASE_URL"]
                     ?? "https://YOUR_PROJECT_ID.supabase.co")!,
    supabaseKey: ProcessInfo.processInfo.environment["SUPABASE_ANON_KEY"]
                     ?? "YOUR_ANON_KEY"
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
    var isBetaTester: Bool { currentProfile?.betaTester ?? false }
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
        try? await supabase.auth.signOut()
        currentProfile = nil
    }
}
