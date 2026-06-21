import SwiftUI

// MARK: - Crew Signup Model

struct CrewSignup: Identifiable {
    let id: UUID
    let householdName: String
    let daysAttending: Set<String>
    let lodging: String
}

// MARK: - FestCrewView

struct FestCrewView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var showSignupSheet = false

    // Placeholder households — real data would come from Supabase
    private let households: [CrewSignup] = [
        CrewSignup(id: UUID(), householdName: "The Hendersons", daysAttending: ["Sunday", "Monday", "Tuesday", "Wednesday"], lodging: "Cabin 3"),
        CrewSignup(id: UUID(), householdName: "The Petersons", daysAttending: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], lodging: "Cabin 7"),
        CrewSignup(id: UUID(), householdName: "The Murphys", daysAttending: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], lodging: "Own place"),
        CrewSignup(id: UUID(), householdName: "The Garcias", daysAttending: ["Tuesday", "Wednesday", "Thursday"], lodging: "Cabin 5"),
    ]

    var body: some View {
        if !env.isSignedIn {
            FestSignInNotice(message: "Sign in to see the crew and sign up your household.")
        } else {
            crewContent
        }
    }

    private var crewContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {

                // Header count
                HStack {
                    Text("\(households.count) households coming")
                        .font(.festSerif(14))
                        .foregroundStyle(Color.mlrFest.opacity(0.7))
                    Spacer()
                    Button {
                        showSignupSheet = true
                    } label: {
                        Label("Sign Up", systemImage: "plus")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(Color.mlrFest)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)

                // Household list
                VStack(spacing: 10) {
                    ForEach(households) { signup in
                        HouseholdCard(signup: signup)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
        }
        .background(Color.mlrFestParchment)
        .sheet(isPresented: $showSignupSheet) {
            CrewSignupSheet()
        }
    }
}

// MARK: - Household Card

private struct HouseholdCard: View {
    let signup: CrewSignup

    private let allDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    private let fullToShort: [String: String] = [
        "Sunday": "Sun", "Monday": "Mon", "Tuesday": "Tue",
        "Wednesday": "Wed", "Thursday": "Thu", "Friday": "Fri", "Saturday": "Sat"
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(signup.householdName)
                    .font(.festSerif(15, weight: .bold))
                    .foregroundStyle(Color.mlrFest)
                Spacer()
                Label(signup.lodging, systemImage: "house.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.mlrFest.opacity(0.6))
            }

            // Day pills
            HStack(spacing: 5) {
                ForEach(allDays, id: \.self) { day in
                    let isAttending = signup.daysAttending.contains(where: { fullToShort[$0] == day })
                    Text(day)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(isAttending ? Color.white : Color.mlrFest.opacity(0.35))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                        .background(
                            isAttending
                                ? Color.mlrFest
                                : Color.mlrFest.opacity(0.08)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                }
            }
        }
        .padding(14)
        .background(Color.mlrFestParchment)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color.mlrFest.opacity(0.18), lineWidth: 1)
        )
    }
}

// MARK: - Crew Signup Sheet

private struct CrewSignupSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var daysAttending: Set<String> = []
    @State private var lodgingPreference = ""
    @State private var isSaving = false

    private let days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    private let lodgingOptions = ["Cabin", "Own place nearby", "Day trips only"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {

                    // Days section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Days You're Attending")
                            .font(.festSerif(16, weight: .bold))
                            .foregroundStyle(Color.mlrFest)

                        Text("Aug 2–8, 2026 · Select all that apply")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.mlrFest.opacity(0.6))

                        ForEach(days, id: \.self) { day in
                            Button {
                                if daysAttending.contains(day) {
                                    daysAttending.remove(day)
                                } else {
                                    daysAttending.insert(day)
                                }
                            } label: {
                                HStack {
                                    Image(systemName: daysAttending.contains(day)
                                          ? "checkmark.square.fill"
                                          : "square")
                                        .font(.system(size: 20))
                                        .foregroundStyle(daysAttending.contains(day)
                                                         ? Color.mlrFest
                                                         : Color.mlrFest.opacity(0.3))
                                    Text(day)
                                        .font(.system(size: 15))
                                        .foregroundStyle(Color.mlrFest)
                                    Spacer()
                                }
                                .padding(.vertical, 6)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(16)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.mlrFestParchment)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(Color.mlrFest.opacity(0.18), lineWidth: 1)
                            )
                    )

                    // Lodging section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Lodging")
                            .font(.festSerif(16, weight: .bold))
                            .foregroundStyle(Color.mlrFest)

                        VStack(spacing: 8) {
                            ForEach(lodgingOptions, id: \.self) { option in
                                Button {
                                    lodgingPreference = option
                                } label: {
                                    HStack {
                                        Image(systemName: lodgingPreference == option
                                              ? "largecircle.fill.circle"
                                              : "circle")
                                            .font(.system(size: 20))
                                            .foregroundStyle(lodgingPreference == option
                                                             ? Color.mlrFest
                                                             : Color.mlrFest.opacity(0.3))
                                        Text(option)
                                            .font(.system(size: 15))
                                            .foregroundStyle(Color.mlrFest)
                                        Spacer()
                                    }
                                    .padding(.vertical, 4)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(16)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.mlrFestParchment)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(Color.mlrFest.opacity(0.18), lineWidth: 1)
                            )
                    )

                    // Submit button
                    Button {
                        Task {
                            isSaving = true
                            // TODO: save to Supabase via env.eventsService or a dedicated crew RPC
                            try? await Task.sleep(nanoseconds: 800_000_000)
                            isSaving = false
                            dismiss()
                        }
                    } label: {
                        HStack {
                            if isSaving {
                                ProgressView()
                                    .tint(.white)
                                    .padding(.trailing, 4)
                            }
                            Text(isSaving ? "Saving…" : "Sign Up My Household")
                        }
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(daysAttending.isEmpty ? Color.mlrFest.opacity(0.4) : Color.mlrFest)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .disabled(daysAttending.isEmpty || isSaving)
                }
                .padding(20)
            }
            .background(Color.mlrFestParchment.ignoresSafeArea())
            .navigationTitle("Sign Up Your Household")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.mlrFestParchment, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(Color.mlrFest)
                }
            }
        }
    }
}

// MARK: - Fest Sign-In Notice
// A parchment-styled, message-only sign-in placeholder for the Family Fest
// section. (The project-wide generic `SignInWall<Content>` lives in
// Shared/Components/GuardView.swift — this is the FF-themed sibling.)

struct FestSignInNotice: View {
    let message: String

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "lock.fill")
                .font(.system(size: 36))
                .foregroundStyle(Color.mlrFest.opacity(0.4))
            Text(message)
                .font(.festSerif(15))
                .foregroundStyle(Color.mlrFest.opacity(0.7))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.mlrFestParchment)
    }
}
