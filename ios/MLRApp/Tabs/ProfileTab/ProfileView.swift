import SwiftUI
import PhotosUI

// MARK: - ProfileView
// The Profile tab. Shows the signed-in member's info with editable fields,
// notification/push settings, beta features, admin hub link, and sign-out.

struct ProfileView: View {
    @Environment(AppEnvironment.self) private var env

    // Form state — mirrors Profile fields
    @State private var name: String = ""
    @State private var phone: String = ""
    @State private var birthday: Date = .now
    @State private var hasBirthday: Bool = false
    @State private var bio: String = ""
    @State private var venmo: String = ""
    @State private var zelle: String = ""
    @State private var appleCash: String = ""

    // UI state
    @State private var isSaving = false
    @State private var saveError: String? = nil
    @State private var showSaveConfirmation = false
    @State private var showSignOutAlert = false
    @State private var showAvatarPicker = false
    @State private var avatarPickerItem: PhotosPickerItem? = nil
    @State private var uploadingAvatar = false

    private var profile: Profile? { env.currentProfile }
    private var isDirty: Bool {
        guard let p = profile else { return false }
        return name != p.name
            || phone != (p.phone ?? "")
            || bio != (p.bio ?? "")
            || venmo != (p.venmoHandle ?? "")
            || zelle != (p.zelleHandle ?? "")
            || appleCash != (p.appleCashHandle ?? "")
            || birthdayChanged(p)
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Group {
                if env.isSignedIn {
                    memberContent
                } else {
                    guestContent
                }
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if env.isSignedIn && isDirty {
                    ToolbarItem(placement: .topBarTrailing) {
                        saveButton
                    }
                }
            }
        }
        .onAppear { seedFormFromProfile() }
        .onChange(of: profile?.id) { seedFormFromProfile() }
        .photosPicker(
            isPresented: $showAvatarPicker,
            selection: $avatarPickerItem,
            matching: .images
        )
        .onChange(of: avatarPickerItem) { _, item in
            guard let item else { return }
            Task { await uploadAvatar(item: item) }
        }
        .alert("Sign out?", isPresented: $showSignOutAlert) {
            Button("Sign Out", role: .destructive) {
                Task { await env.signOut() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll need to sign in again to post, RSVP, or access member features.")
        }
        .overlay {
            if showSaveConfirmation {
                confirmationToast
            }
        }
    }

    // MARK: - Member content

    private var memberContent: some View {
        Form {
            // 1. Avatar header
            avatarSection

            // 2. Edit profile
            editProfileSection

            // 3. Payment handles
            paymentSection

            // 4. Notifications
            notificationsSection

            // 5. Beta features (beta testers only)
            if env.isBetaTester {
                betaSection
            }

            // 6. Admin hub (admins only)
            if env.isAdmin {
                adminSection
            }

            // 7. Sign out
            signOutSection

            // 8. App info
            appInfoSection
        }
        .scrollContentBackground(.hidden)
        .background(Color.mlrSurface)
    }

    // MARK: - Avatar section

    private var avatarSection: some View {
        Section {
            HStack {
                Spacer()
                VStack(spacing: 12) {
                    ZStack(alignment: .bottomTrailing) {
                        AvatarView(
                            url: profile?.avatarUrl,
                            size: .xlarge,
                            isAdmin: profile?.isAdmin ?? false
                        )
                        .overlay {
                            if uploadingAvatar {
                                Circle()
                                    .fill(Color.black.opacity(0.4))
                                ProgressView()
                                    .tint(.white)
                            }
                        }

                        Button {
                            showAvatarPicker = true
                        } label: {
                            Image(systemName: "camera.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(width: 28, height: 28)
                                .background(Color.mlrPrimary)
                                .clipShape(Circle())
                                .overlay(
                                    Circle()
                                        .stroke(Color.mlrSurface, lineWidth: 2)
                                )
                        }
                    }

                    Text(profile?.name ?? "")
                        .font(.title3.bold())
                        .foregroundStyle(Color.mlrText)

                    Text(profile?.email ?? "")
                        .font(.subheadline)
                        .foregroundStyle(Color.mlrTextMuted)
                }
                Spacer()
            }
            .padding(.vertical, 8)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
    }

    // MARK: - Edit profile section

    private var editProfileSection: some View {
        Section("Profile") {
            LabeledContent("Name") {
                TextField("Your name", text: $name)
                    .multilineTextAlignment(.trailing)
                    .autocorrectionDisabled()
            }

            LabeledContent("Phone") {
                TextField("(715) 555-1234", text: $phone)
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
            }

            // Birthday picker
            Toggle(isOn: $hasBirthday) {
                Text("Birthday")
            }
            .tint(Color.mlrPrimary)

            if hasBirthday {
                DatePicker(
                    "Date",
                    selection: $birthday,
                    in: ...Date.now,
                    displayedComponents: .date
                )
                .datePickerStyle(.compact)
                .tint(Color.mlrPrimary)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Bio")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.mlrTextMuted)
                TextEditor(text: $bio)
                    .frame(minHeight: 80)
                    .onChange(of: bio) { _, val in
                        if val.count > 200 { bio = String(val.prefix(200)) }
                    }
                HStack {
                    Spacer()
                    Text("\(bio.count)/200")
                        .font(.caption2)
                        .foregroundStyle(Color.mlrTextSubtle)
                }
            }
        }
    }

    // MARK: - Payment section

    private var paymentSection: some View {
        Section("Payment Handles") {
            LabeledContent {
                TextField("@username", text: $venmo)
                    .multilineTextAlignment(.trailing)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            } label: {
                Label("Venmo", systemImage: "v.circle.fill")
                    .foregroundStyle(Color.mlrPrimary)
            }

            LabeledContent {
                TextField("Phone or email", text: $zelle)
                    .multilineTextAlignment(.trailing)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            } label: {
                Label("Zelle", systemImage: "z.circle.fill")
                    .foregroundStyle(Color.mlrInfo)
            }

            LabeledContent {
                TextField("Phone or $Cashtag", text: $appleCash)
                    .multilineTextAlignment(.trailing)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            } label: {
                Label("Apple Cash", systemImage: "applelogo")
                    .foregroundStyle(Color.mlrText)
            }
        }
    }

    // MARK: - Notifications section

    private var notificationsSection: some View {
        Section("Notifications") {
            NavigationLink {
                NotifPrefsView()
            } label: {
                Label("Activity notifications", systemImage: "bell.badge.fill")
                    .foregroundStyle(Color.mlrText)
            }

            NavigationLink {
                PushToggleView()
            } label: {
                Label("Push notifications", systemImage: "app.badge.fill")
                    .foregroundStyle(Color.mlrText)
            }
        }
    }

    // MARK: - Beta section

    private var betaSection: some View {
        Section {
            // AI Assistant toggle
            AssistantToggleRow()

            // Willing to help toggle
            WillingToHelpRow()

            NavigationLink {
                BetaInfoView()
            } label: {
                Label("Beta features info", systemImage: "flask.fill")
                    .foregroundStyle(Color.mlrText)
            }
        } header: {
            HStack(spacing: 4) {
                Image(systemName: "flask.fill")
                    .font(.system(size: 10))
                Text("Beta Features")
            }
            .foregroundStyle(Color.mlrAccent)
        }
    }

    // MARK: - Admin section

    private var adminSection: some View {
        Section("Admin") {
            NavigationLink {
                AdminView()
            } label: {
                Label("Admin tools", systemImage: "shield.fill")
                    .foregroundStyle(Color.mlrPrimary)
            }
        }
    }

    // MARK: - Sign out section

    private var signOutSection: some View {
        Section {
            Button(role: .destructive) {
                showSignOutAlert = true
            } label: {
                HStack {
                    Spacer()
                    Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    Spacer()
                }
            }
        }
    }

    // MARK: - App info section

    private var appInfoSection: some View {
        Section {
            HStack {
                Spacer()
                VStack(spacing: 4) {
                    Text("Muskellunge Lake Resort")
                        .font(.footnote.bold())
                        .foregroundStyle(Color.mlrTextMuted)
                    Text("Est. 1987 · Leo & Dorothy Theis")
                        .font(.caption2)
                        .foregroundStyle(Color.mlrTextSubtle)
                    if let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
                       let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String {
                        Text("v\(version) (\(build))")
                            .font(.caption2)
                            .foregroundStyle(Color.mlrTextSubtle)
                    }
                }
                Spacer()
            }
            .padding(.vertical, 4)
            .listRowBackground(Color.clear)
        }
    }

    // MARK: - Save button

    private var saveButton: some View {
        Button {
            Task { await saveProfile() }
        } label: {
            if isSaving {
                ProgressView()
                    .tint(Color.mlrPrimary)
            } else {
                Text("Save")
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.mlrPrimary)
            }
        }
        .disabled(isSaving)
    }

    // MARK: - Confirmation toast

    private var confirmationToast: some View {
        VStack {
            Spacer()
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.white)
                Text("Profile saved")
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Color.mlrSuccess)
            .clipShape(Capsule())
            .shadow(color: Color.black.opacity(0.15), radius: 8, y: 4)
            .padding(.bottom, 32)
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .allowsHitTesting(false)
    }

    // MARK: - Guest content

    private var guestContent: some View {
        VStack(spacing: 28) {
            Image(systemName: "person.crop.circle")
                .font(.system(size: 64, weight: .light))
                .foregroundStyle(Color.mlrPrimary.opacity(0.5))

            VStack(spacing: 8) {
                Text("Sign in to access your profile")
                    .font(.title3.bold())
                Text("Manage your info, payment handles, and notification settings.")
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

            appInfoSection
                .opacity(0.7)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.mlrSurface)
    }

    // MARK: - Helpers

    private func seedFormFromProfile() {
        guard let p = profile else { return }
        name = p.name
        phone = p.phone ?? ""
        bio = p.bio ?? ""
        venmo = p.venmoHandle ?? ""
        zelle = p.zelleHandle ?? ""
        appleCash = p.appleCashHandle ?? ""

        if let bdStr = p.birthday,
           let bd = ISO8601DateFormatter().date(from: bdStr) {
            birthday = bd
            hasBirthday = true
        } else {
            birthday = .now
            hasBirthday = false
        }
    }

    private func birthdayChanged(_ p: Profile) -> Bool {
        let stored = p.birthday ?? ""
        if hasBirthday {
            let fmt = DateFormatter()
            fmt.dateFormat = "yyyy-MM-dd"
            return stored != fmt.string(from: birthday)
        } else {
            return !stored.isEmpty
        }
    }

    @MainActor
    private func saveProfile() async {
        guard let userId = profile?.id else { return }
        isSaving = true
        saveError = nil
        defer { isSaving = false }

        var updates: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespaces),
            "phone": phone.trimmingCharacters(in: .whitespaces),
            "bio": bio.trimmingCharacters(in: .whitespaces),
            "venmo_handle": venmo.trimmingCharacters(in: .whitespaces),
            "zelle_handle": zelle.trimmingCharacters(in: .whitespaces),
            "apple_cash_handle": appleCash.trimmingCharacters(in: .whitespaces)
        ]

        if hasBirthday {
            let fmt = DateFormatter()
            fmt.dateFormat = "yyyy-MM-dd"
            updates["birthday"] = fmt.string(from: birthday)
        } else {
            updates["birthday"] = NSNull()
        }

        do {
            try await supabase
                .from("profiles")
                .update(updates)
                .eq("id", value: userId.uuidString)
                .execute()
            await env.loadProfile()
            withAnimation { showSaveConfirmation = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                withAnimation { showSaveConfirmation = false }
            }
        } catch {
            saveError = "Couldn't save profile. Please try again."
        }
    }

    @MainActor
    private func uploadAvatar(item: PhotosPickerItem) async {
        guard let userId = profile?.id else { return }
        uploadingAvatar = true
        defer { uploadingAvatar = false }

        guard let data = try? await item.loadTransferable(type: Data.self) else { return }

        let path = "\(userId.uuidString)/avatar.jpg"
        do {
            _ = try await supabase.storage
                .from("avatars")
                .upload(path, data: data, options: FileOptions(contentType: "image/jpeg", upsert: true))

            let publicUrl = try supabase.storage
                .from("avatars")
                .getPublicURL(path: path)

            try await supabase
                .from("profiles")
                .update(["avatar_url": publicUrl.absoluteString])
                .eq("id", value: userId.uuidString)
                .execute()

            await env.loadProfile()
        } catch {
            // Non-fatal — just clear the picker
        }
        avatarPickerItem = nil
    }
}

// MARK: - HelpService extensions
// Methods expected by ProfileView (and HomeView) that are not yet in HelpService.

extension HelpService {
    /// Toggle the `willing_to_help` flag for `userId`.
    func setWillingToHelp(userId: UUID, willing: Bool) async throws {
        struct Params: Encodable { let p_user_id: String; let p_willing: Bool }
        try await supabase
            .rpc("set_willing_to_help", params: Params(p_user_id: userId.uuidString, p_willing: willing))
            .execute()
    }

    /// Return the count of currently open help requests (for the 10-cap UI guard).
    func fetchOpenRequestCount() async throws -> Int {
        struct CountRow: Decodable { let count: Int }
        let rows: [CountRow] = try await supabase
            .from("help_requests")
            .select("count:id.count()")
            .eq("status", value: "open")
            .execute()
            .value
        return rows.first?.count ?? 0
    }
}

// MARK: - AssistantToggleRow

private struct AssistantToggleRow: View {
    @AppStorage("assistant_enabled") private var assistantEnabled = false

    var body: some View {
        Toggle(isOn: $assistantEnabled) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("AI Assistant")
                        .font(.system(size: 15))
                    Text("Ask MLR — answers from app data")
                        .font(.caption)
                        .foregroundStyle(Color.mlrTextMuted)
                }
            } icon: {
                Image(systemName: "sparkles")
                    .foregroundStyle(Color.mlrAccent)
            }
        }
        .tint(Color.mlrPrimary)
    }
}

// MARK: - WillingToHelpRow

private struct WillingToHelpRow: View {
    @Environment(AppEnvironment.self) private var env
    @State private var isUpdating = false

    private var willing: Bool { env.currentProfile?.willingToHelp ?? false }

    var body: some View {
        Toggle(isOn: Binding(
            get: { willing },
            set: { _ in Task { await toggle() } }
        )) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Willing to Help")
                        .font(.system(size: 15))
                    Text("Get pinged when someone needs a hand at the resort")
                        .font(.caption)
                        .foregroundStyle(Color.mlrTextMuted)
                }
            } icon: {
                Image(systemName: "hand.raised.fill")
                    .foregroundStyle(Color.mlrDanger)
            }
        }
        .tint(Color.mlrPrimary)
        .disabled(isUpdating)
    }

    private func toggle() async {
        guard let profile = env.currentProfile else { return }
        isUpdating = true
        defer { isUpdating = false }
        try? await env.helpService.setWillingToHelp(userId: profile.id, willing: !profile.willingToHelp)
        await env.loadProfile()
    }
}

// MARK: - BetaInfoView

private struct BetaInfoView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("You're in the beta tester group, which gives you early access to features being tested before they roll out to everyone.")
                    .font(.body)

                Text("Current beta features:")
                    .font(.headline)

                BulletPoint("AI Assistant — ask questions about the resort schedule, who's in charge of what, and more.")
                BulletPoint("Ask for Help — post a quick request when you need a hand at the resort.")
                BulletPoint("Willing to Help — opt in to receive help request notifications.")

                Text("Your feedback directly shapes what ships. If something feels off, let an admin know.")
                    .font(.body)
                    .foregroundStyle(Color.mlrTextMuted)
            }
            .padding()
        }
        .navigationTitle("Beta Features")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct BulletPoint: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•")
                .foregroundStyle(Color.mlrPrimary)
            Text(text)
                .font(.subheadline)
        }
    }
}

#Preview {
    ProfileView()
        .environment(AppEnvironment())
}
