import SwiftUI

// MARK: - NotifPrefsView
// Per-kind notification preference toggles. Saves to `profiles.notif_types`.

struct NotifPrefsView: View {
    @Environment(AppEnvironment.self) private var env

    @State private var enabledTypes: Set<NotifType> = []
    @State private var isSaving = false
    @State private var error: String? = nil
    @State private var saved = false

    private var profile: Profile? { env.currentProfile }

    // MARK: - Body

    var body: some View {
        Form {
            Section {
                Text("Choose which activities send you an in-app notification. These controls are independent of push notifications.")
                    .font(.subheadline)
                    .foregroundStyle(Color.mlrTextMuted)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }

            // Your activity
            Section("Your Activity") {
                toggle(for: .postComment,  label: "Comments on your posts",   icon: "bubble.left.fill")
                toggle(for: .postReply,    label: "Replies to your comments", icon: "arrowshape.turn.up.left.fill")
                toggle(for: .postMention,  label: "Post @mentions",           icon: "at")
                toggle(for: .postTag,      label: "Tagged in a post",         icon: "tag.fill")
                toggle(for: .postReaction, label: "Reactions to your posts",  icon: "heart.fill")
            }

            // Social
            Section("Social") {
                toggle(for: .newPost,     label: "New posts in the feed", icon: "rectangle.stack.fill")
                toggle(for: .chatMention, label: "Chat @mentions",        icon: "bubble.left.and.bubble.right.fill")
            }

            // Committees
            Section("Committees") {
                toggle(for: .committeeJoin, label: "Joined a committee you lead", icon: "person.badge.plus")
                if env.isAdmin {
                    toggle(for: .committeeJoinRequest, label: "New committee join requests", icon: "person.badge.clock")
                        .foregroundStyle(Color.mlrText)
                }
            }

            // Cabin
            Section("Cabin Stays") {
                if env.isAdmin {
                    toggle(for: .cabinRequest, label: "New cabin booking requests", icon: "house.lodge.fill")
                }
                toggle(for: .cabinDecision, label: "Decisions on your cabin requests", icon: "house.lodge.fill")
            }

            // Events
            Section("Events") {
                toggle(for: .eventRsvp, label: "RSVPs to your events", icon: "calendar.badge.checkmark")
            }

            // Help Requests
            Section("Help Requests") {
                toggle(for: .helpRequest,  label: "Help requests near you", icon: "hand.raised.fill")
                toggle(for: .helpResponse, label: "Someone's on their way",  icon: "figure.walk")
            }
        }
        .navigationTitle("Activity Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isSaving {
                    ProgressView()
                } else if saved {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Color.mlrSuccess)
                }
            }
        }
        .onAppear { seedFromProfile() }
        .onChange(of: enabledTypes) { _, _ in
            Task { await savePrefs() }
        }
    }

    // MARK: - Toggle builder

    private func toggle(for type: NotifType, label: String, icon: String) -> some View {
        Toggle(isOn: Binding(
            get: { enabledTypes.contains(type) },
            set: { enabled in
                if enabled { enabledTypes.insert(type) }
                else { enabledTypes.remove(type) }
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
    }

    // MARK: - Helpers

    private func seedFromProfile() {
        guard let p = profile else { return }
        enabledTypes = Set(p.notifTypes)
    }

    @MainActor
    private func savePrefs() async {
        guard let userId = profile?.id else { return }
        isSaving = true
        saved = false
        defer { isSaving = false }

        let types = enabledTypes.map(\.rawValue)
        do {
            try await supabase
                .from("profiles")
                .update(["notif_types": types])
                .eq("id", value: userId.uuidString)
                .execute()
            await env.loadProfile()
            saved = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                saved = false
            }
        } catch {
            self.error = "Couldn't save preferences."
        }
    }
}

#Preview {
    NavigationStack {
        NotifPrefsView()
    }
    .environment(AppEnvironment())
}
