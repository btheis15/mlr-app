import Foundation
import UserNotifications
import UIKit
import Supabase

// MARK: - PushService

/// Manages APNs permission, device-token persistence, and push-type preferences.
/// Not @Observable — callers that need reactive state (e.g. a toggle) read
/// profiles.push_level / profiles.push_types through AppEnvironment.currentProfile.
final class PushService {

    // MARK: - Permission + registration

    /// Request notification permission and, on grant, register for remote notifications.
    /// Returns `true` if the user granted permission (new or previously granted).
    @MainActor
    @discardableResult
    func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            if granted {
                await UIApplication.shared.registerForRemoteNotifications()
            }
            return granted
        } catch {
            print("[PushService] requestAuthorization error: \(error)")
            return false
        }
    }

    // MARK: - Token persistence

    /// Upsert the APNs device token into `apns_subscriptions`.
    /// Call after receiving a token in AppDelegate.didRegisterForRemoteNotificationsWithDeviceToken.
    func saveToken(token: String, userId: UUID) async {
        struct Subscription: Encodable {
            let user_id: String
            let device_token: String
            let environment: String
        }
        let env = buildEnvironment()
        do {
            try await supabase
                .from("apns_subscriptions")
                .upsert(
                    Subscription(
                        user_id: userId.uuidString,
                        device_token: token,
                        environment: env
                    ),
                    onConflict: "user_id,device_token"
                )
                .execute()
            // Persist locally so we can detect staleness later
            storedToken = token
        } catch {
            print("[PushService] saveToken error: \(error)")
        }
    }

    /// Call on every app launch when signed in.
    /// If the AppDelegate has received a new APNs token that differs from the stored one,
    /// persist the fresh token immediately.
    func reconcileToken() async {
        guard
            let userId = try? await supabase.auth.session.user.id,
            let currentToken = AppDelegate.apnsToken
        else { return }

        if currentToken != storedToken {
            await saveToken(token: currentToken, userId: userId)
        }
    }

    /// Delete this device's subscription row on sign-out.
    func removeToken(userId: UUID) async {
        guard let token = AppDelegate.apnsToken ?? storedToken else { return }
        do {
            try await supabase
                .from("apns_subscriptions")
                .delete()
                .eq("user_id", value: userId.uuidString)
                .eq("device_token", value: token)
                .execute()
            storedToken = nil
        } catch {
            print("[PushService] removeToken error: \(error)")
        }
    }

    // MARK: - Push-type preferences

    /// Update the `push_types` column for the signed-in user.
    func updatePushTypes(userId: UUID, types: [PushType]) async {
        let rawTypes = types.map(\.rawValue)
        do {
            try await supabase
                .from("profiles")
                .update(["push_types": rawTypes])
                .eq("id", value: userId.uuidString)
                .execute()
        } catch {
            print("[PushService] updatePushTypes error: \(error)")
        }
    }

    // MARK: - Private

    /// Last token we successfully persisted, so we can skip redundant upserts.
    private var storedToken: String? {
        get { UserDefaults.standard.string(forKey: "mlr_apns_token") }
        set { UserDefaults.standard.set(newValue, forKey: "mlr_apns_token") }
    }

    private func buildEnvironment() -> String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }
}
