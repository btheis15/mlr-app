import SwiftUI
import UserNotifications

// MARK: - PushToggleView
// Push notification settings. Master toggle + per-type granular control.
// When enabling: requests permission then shows granular toggles.
// When disabling: removes APNs token from Supabase.

struct PushToggleView: View {
    @Environment(AppEnvironment.self) private var env

    @State private var permissionStatus: UNAuthorizationStatus = .notDetermined
    @State private var masterEnabled: Bool = false
    @State private var enabledTypes: Set<PushType> = []
    @State private var isRequesting = false
    @State private var isSaving = false
    @State private var saved = false
    @State private var showSettingsAlert = false

    private var profile: Profile? { env.currentProfile }

    // MARK: - Body

    var body: some View {
        Form {
            // Explanation
            Section {
                Text("Push notifications work on iOS when the app is added to your Home Screen.")
                    .font(.subheadline)
                    .foregroundStyle(Color.mlrTextMuted)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }

            // Master toggle
            Section {
                Toggle(isOn: Binding(
                    get: { masterEnabled },
                    set: { enabled in Task { await setMaster(enabled: enabled) } }
                )) {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Push Notifications")
                                .font(.system(size: 15, weight: .medium))
                            if masterEnabled {
                                Text("Notifications are sent to this device")
                                    .font(.caption)
                                    .foregroundStyle(Color.mlrSuccess)
                            } else {
                                Text("Tap to enable on this device")
                                    .font(.caption)
                                    .foregroundStyle(Color.mlrTextMuted)
                            }
                        }
                    } icon: {
                        Image(systemName: masterEnabled ? "bell.badge.fill" : "bell.slash.fill")
                            .foregroundStyle(masterEnabled ? Color.mlrPrimary : Color.mlrTextSubtle)
                    }
                }
                .tint(Color.mlrPrimary)
                .disabled(isRequesting || isSaving)

                // Permission denied banner
                if permissionStatus == .denied {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(Color.mlrWarning)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Notifications are blocked")
                                .font(.subheadline.bold())
                            Text("Allow in iOS Settings to enable push.")
                                .font(.caption)
                                .foregroundStyle(Color.mlrTextMuted)
                        }
                        Spacer()
                        Button("Settings") {
                            openSettings()
                        }
                        .font(.caption.bold())
                        .foregroundStyle(Color.mlrPrimary)
                    }
                    .padding(.vertical, 4)
                }
            }

            // Granular toggles (only when master is on)
            if masterEnabled && permissionStatus == .authorized {
                Section("Notify me about…") {
                    pushToggle(for: .alerts,    label: "Announcements & alerts",  icon: "megaphone.fill")
                    pushToggle(for: .chat,      label: "Chat messages",            icon: "bubble.left.fill")
                    pushToggle(for: .postMention, label: "Post @mentions",         icon: "at")
                    pushToggle(for: .eventRsvp, label: "Event RSVPs",              icon: "calendar.badge.checkmark")
                    pushToggle(for: .cabinDecision, label: "Cabin stay decisions", icon: "house.lodge.fill")
                    pushToggle(for: .committeeJoin, label: "Committee joins",      icon: "person.badge.plus")
                    pushToggle(for: .helpRequest,  label: "Help requests",         icon: "hand.raised.fill")
                    pushToggle(for: .helpResponse, label: "Help responses",        icon: "figure.walk")

                    if env.isAdmin {
                        Divider()
                        pushToggle(for: .committeeJoinRequest, label: "Committee join requests (admin)", icon: "person.badge.clock")
                    }
                }
            }
        }
        .navigationTitle("Push Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isRequesting || isSaving {
                    ProgressView()
                } else if saved {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Color.mlrSuccess)
                }
            }
        }
        .alert("Open iOS Settings", isPresented: $showSettingsAlert) {
            Button("Open Settings") { openSettings() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Go to Settings → Notifications → MLR and allow notifications.")
        }
        .task {
            await refreshPermissionStatus()
            seedFromProfile()
        }
    }

    // MARK: - Push type toggle

    private func pushToggle(for type: PushType, label: String, icon: String) -> some View {
        Toggle(isOn: Binding(
            get: { enabledTypes.contains(type) },
            set: { enabled in
                if enabled { enabledTypes.insert(type) }
                else { enabledTypes.remove(type) }
                Task { await saveTypes() }
            }
        )) {
            Label {
                Text(label)
                    .font(.system(size: 15))
            } icon: {
                Image(systemName: icon)
                    .foregroundStyle(Color.mlrPrimary)
            }
        }
        .tint(Color.mlrPrimary)
        .disabled(isSaving)
    }

    // MARK: - Actions

    @MainActor
    private func setMaster(enabled: Bool) async {
        if enabled {
            await requestPermission()
        } else {
            await disablePush()
        }
    }

    @MainActor
    private func requestPermission() async {
        isRequesting = true
        defer { isRequesting = false }

        let center = UNUserNotificationCenter.current()
        let current = await center.notificationSettings()

        switch current.authorizationStatus {
        case .denied:
            permissionStatus = .denied
            return

        case .authorized, .provisional, .ephemeral:
            permissionStatus = .authorized
            masterEnabled = true
            await env.pushService.requestPermission()
            await saveLevel(level: "all")

        case .notDetermined:
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
                if granted {
                    permissionStatus = .authorized
                    masterEnabled = true
                    UIApplication.shared.registerForRemoteNotifications()
                    await env.pushService.requestPermission()
                    await saveLevel(level: "all")
                } else {
                    permissionStatus = .denied
                    masterEnabled = false
                }
            } catch {
                masterEnabled = false
            }

        @unknown default:
            masterEnabled = false
        }
    }

    @MainActor
    private func disablePush() async {
        isSaving = true
        defer { isSaving = false }
        guard let userId = profile?.id else { return }
        masterEnabled = false
        try? await env.pushService.removeToken(userId: userId)
        await saveLevel(level: "off")
    }

    @MainActor
    private func saveLevel(level: String) async {
        guard let userId = profile?.id else { return }
        try? await supabase
            .from("profiles")
            .update(["push_level": level])
            .eq("id", value: userId.uuidString)
            .execute()
        await env.loadProfile()
    }

    @MainActor
    private func saveTypes() async {
        guard let userId = profile?.id else { return }
        isSaving = true
        saved = false
        defer { isSaving = false }

        let types = enabledTypes.map(\.rawValue)
        do {
            try await supabase
                .from("profiles")
                .update(["push_types": types])
                .eq("id", value: userId.uuidString)
                .execute()
            await env.loadProfile()
            saved = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { saved = false }
        } catch {
            // Non-fatal
        }
    }

    private func seedFromProfile() {
        guard let p = profile else { return }
        masterEnabled = (p.pushLevel != nil && p.pushLevel != "off")
        enabledTypes = Set(p.pushTypes)
    }

    private func refreshPermissionStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        await MainActor.run { permissionStatus = settings.authorizationStatus }
    }

    private func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}

#Preview {
    NavigationStack {
        PushToggleView()
    }
    .environment(AppEnvironment())
}
