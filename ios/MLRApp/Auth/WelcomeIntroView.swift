import SwiftUI
import Supabase

// MARK: - WelcomeIntroView
// Two-step onboarding sheet shown once to brand-new members whose
// profiles.intro_seen == false and whose profile is sparse (name + email only).
// Step 1: collect phone, birthday, payment handle.
// Step 2: explain push notifications, embed PushToggleView, mark intro done.

struct WelcomeIntroView: View {
    @Environment(AppEnvironment.self) private var env

    // Drives the PageTabView — 0 = welcome/collect, 1 = push prefs
    @State private var currentStep: Int = 0

    // Step 1 fields
    @State private var phone: String = ""
    @State private var birthday: Date = Calendar.current.date(
        from: DateComponents(year: 1990, month: 1, day: 1)
    ) ?? .now
    @State private var birthdaySet: Bool = false
    @State private var venmo: String = ""
    @State private var zelle: String = ""
    @State private var appleCash: String = ""

    // Step 2 state
    @State private var isSaving: Bool = false
    @State private var saveError: String? = nil

    @FocusState private var phoneFocused: Bool

    private var profile: Profile? { env.currentProfile }

    var body: some View {
        TabView(selection: $currentStep) {
            // ── Step 1 ──────────────────────────────────────────────
            step1View
                .tag(0)

            // ── Step 2 ──────────────────────────────────────────────
            step2View
                .tag(1)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .animation(.easeInOut, value: currentStep)
        .interactiveDismissDisabled(true) // must complete intro
        .onAppear {
            if let p = profile {
                phone      = p.phone ?? ""
                venmo      = p.venmoHandle ?? ""
                zelle      = p.zelleHandle ?? ""
                appleCash  = p.appleCashHandle ?? ""
                if let bdStr = p.birthday,
                   let bd = isoDateFormatter.date(from: bdStr) {
                    birthday    = bd
                    birthdaySet = true
                }
            }
        }
    }

    // MARK: - Step 1: Welcome + collect basics

    private var step1View: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                // Hero
                VStack(spacing: 8) {
                    Image("brand-logo-green")
                        .resizable()
                        .scaledToFit()
                        .frame(height: 64)
                        .frame(maxWidth: .infinity)

                    Text("Welcome to MLR!")
                        .font(.title.bold())
                        .frame(maxWidth: .infinity)

                    Text("Tell us a little about yourself so the family can reach you.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                .padding(.top, 8)

                // Phone
                formSection(title: "Phone (optional)") {
                    TextField("(715) 555-0100", text: $phone)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        .focused($phoneFocused)
                        .fieldStyle()
                }

                // Birthday
                formSection(title: "Birthday (optional)") {
                    VStack(alignment: .leading, spacing: 6) {
                        if birthdaySet {
                            HStack {
                                Text(birthday.formatted(.dateTime.month(.wide).day().year()))
                                    .foregroundStyle(.primary)
                                Spacer()
                                Button("Clear") {
                                    birthdaySet = false
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                            .padding()
                            .background(Color(.systemGray6))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        } else {
                            Button("Add birthday") {
                                birthdaySet = true
                            }
                            .foregroundStyle(Color("primary"))
                        }

                        if birthdaySet {
                            DatePicker(
                                "Birthday",
                                selection: $birthday,
                                in: ...Date.now,
                                displayedComponents: .date
                            )
                            .datePickerStyle(.wheel)
                            .labelsHidden()
                        }
                    }
                }

                // Payment handles
                formSection(title: "Preferred payment (optional)",
                            subtitle: "So family can reimburse or pay you easily.") {
                    VStack(spacing: 10) {
                        paymentField(icon: "v.circle.fill",
                                     color: .blue,
                                     placeholder: "Venmo @handle",
                                     text: $venmo)
                        paymentField(icon: "z.circle.fill",
                                     color: .purple,
                                     placeholder: "Zelle email or phone",
                                     text: $zelle)
                        paymentField(icon: "applelogo",
                                     color: .primary,
                                     placeholder: "Apple Cash handle",
                                     text: $appleCash)
                    }
                }

                // Continue button
                Button {
                    Task { await saveStep1() }
                } label: {
                    Text("Continue")
                        .font(.body.bold())
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                }
                .background(Color("primary"))
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .padding(.top, 8)

                stepIndicator(active: 0)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
    }

    // MARK: - Step 2: Push notification explanation + prefs

    private var step2View: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(spacing: 8) {
                    Image(systemName: "bell.badge.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(Color("primary"))
                        .frame(maxWidth: .infinity)

                    Text("Stay in the loop")
                        .font(.title.bold())
                        .frame(maxWidth: .infinity)

                    Text("Turn on the things you'd like to hear about. You can change these anytime in Profile → Notifications.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                .padding(.top, 8)

                // Embedded push prefs — uses the real PushToggleView
                PushToggleView()

                if let saveError {
                    Text(saveError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.top, 4)
                }

                // Done button
                Button {
                    Task { await finishIntro() }
                } label: {
                    Group {
                        if isSaving {
                            ProgressView().tint(.white)
                        } else {
                            Text("Done — take me to the resort")
                                .font(.body.bold())
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                }
                .background(Color("primary"))
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .disabled(isSaving)

                stepIndicator(active: 1)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
    }

    // MARK: - Sub-views

    private func formSection<Content: View>(
        title: String,
        subtitle: String? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            if let subtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            content()
        }
    }

    private func paymentField(
        icon: String,
        color: Color,
        placeholder: String,
        text: Binding<String>
    ) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(color)
                .frame(width: 24)
            TextField(placeholder, text: text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
        .padding()
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func stepIndicator(active: Int) -> some View {
        HStack(spacing: 8) {
            ForEach(0..<2, id: \.self) { i in
                Capsule()
                    .fill(i == active ? Color("primary") : Color(.systemGray4))
                    .frame(width: i == active ? 20 : 8, height: 8)
                    .animation(.easeInOut, value: active)
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Actions

    private func saveStep1() async {
        // Persist the collected info to the profile row
        guard let userId = await env.authService.userId else { return }

        let birthdayStr = birthdaySet
            ? isoDateFormatter.string(from: birthday)
            : nil

        let params: [String: AnyJSON] = [
            "phone":             phone.isEmpty  ? .null : .string(phone),
            "birthday":          birthdayStr == nil ? .null : .string(birthdayStr!),
            "venmo_handle":      venmo.isEmpty  ? .null : .string(venmo),
            "zelle_handle":      zelle.isEmpty  ? .null : .string(zelle),
            "apple_cash_handle": appleCash.isEmpty ? .null : .string(appleCash)
        ]

        do {
            try await supabase
                .from("profiles")
                .update(params)
                .eq("id", value: userId.uuidString)
                .execute()

            // Refresh local profile
            await env.loadProfile()

            withAnimation {
                currentStep = 1
            }
        } catch {
            // Non-blocking — let them proceed even if the update fails
            withAnimation { currentStep = 1 }
            print("[WelcomeIntroView] saveStep1 error: \(error)")
        }
    }

    private func finishIntro() async {
        isSaving = true
        saveError = nil
        defer { isSaving = false }

        do {
            // Call the mark_intro_seen RPC
            try await supabase
                .rpc("mark_intro_seen")
                .execute()

            // Update local state so the sheet dismisses immediately
            env.currentProfile?.introSeen = true
        } catch {
            saveError = "Couldn't save — you can finish setup in Profile."
            // Still dismiss so the user isn't stuck
            env.currentProfile?.introSeen = true
            print("[WelcomeIntroView] finishIntro error: \(error)")
        }
    }
}

// MARK: - PushToggleView stub
// The real implementation lives in the profile/notifications area.
// This stub renders here until that file exists; replace with the real import.

private struct PushToggleView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Notification preferences")
                .font(.headline)

            ForEach(NotifType.allCases, id: \.self) { kind in
                let label = kind.displayLabel
                let isOn = Binding<Bool>(
                    get: { env.currentProfile?.notifTypes.contains(kind) ?? true },
                    set: { enabled in
                        Task { await toggleNotif(kind: kind, enabled: enabled) }
                    }
                )
                Toggle(label, isOn: isOn)
                    .tint(Color("primary"))
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func toggleNotif(kind: NotifType, enabled: Bool) async {
        guard let userId = await env.authService.userId else { return }
        var types = env.currentProfile?.notifTypes ?? NotifType.allCases
        if enabled {
            if !types.contains(kind) { types.append(kind) }
        } else {
            types.removeAll { $0 == kind }
        }
        env.currentProfile?.notifTypes = types
        let rawTypes = types.map(\.rawValue)
        try? await supabase
            .from("profiles")
            .update(["notif_types": rawTypes])
            .eq("id", value: userId.uuidString)
            .execute()
    }
}

// MARK: - Helpers

private extension NotifType {
    var displayLabel: String {
        switch self {
        case .postComment:          return "Comments on my posts"
        case .postReply:            return "Replies to my comments"
        case .postMention:          return "Mentions in posts"
        case .postTag:              return "Tags in posts"
        case .postReaction:         return "Reactions on my posts"
        case .newPost:              return "New posts in the feed"
        case .chatMention:          return "Mentions in committee chat"
        case .committeeJoin:        return "Committee membership updates"
        case .committeeJoinRequest: return "Committee join requests (admin)"
        case .cabinRequest:         return "Cabin stay requests (admin)"
        case .cabinDecision:        return "My cabin stay decisions"
        case .eventRsvp:            return "Event RSVP updates"
        case .helpRequest:          return "Help requests"
        case .helpResponse:         return "Responses to my help requests"
        case .broadcast:            return "Resort announcements"
        }
    }
}

private extension NotifType {
    static var allCases: [NotifType] {
        [.postComment, .postReply, .postMention, .postReaction,
         .newPost, .chatMention, .committeeJoin, .cabinDecision,
         .eventRsvp, .helpRequest, .helpResponse, .broadcast]
    }
}

// Convenience field style modifier
private extension View {
    func fieldStyle() -> some View {
        self
            .padding()
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

private let isoDateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.locale = Locale(identifier: "en_US_POSIX")
    return f
}()

#Preview {
    WelcomeIntroView()
        .environment(AppEnvironment())
}
