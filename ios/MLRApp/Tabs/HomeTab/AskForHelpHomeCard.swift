import SwiftUI

// MARK: - AskForHelpHomeCard
// Beta-gated home card for the "Ask for Help" feature.
// Mirrors components/AskForHelpHomeCard.tsx.
//
// Only shown when:
//   • env.isBetaTester is true
//   • fewer than 10 open requests exist (cap checked by HomeView)
//
// Includes:
//   • "Post a request" button → opens AskForHelpSheet
//   • "Willing to Help" inline toggle

struct AskForHelpHomeCard: View {
    let willingToHelp: Bool
    let onAsk: () -> Void
    let onToggleWilling: () async -> Void

    @State private var isTogglingWilling = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack(spacing: 6) {
                Text("🤝")
                    .font(.system(size: 18))
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text("Ask for Help")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.mlrText)
                        Text("BETA")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Color.mlrAccent)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Color.mlrAccent.opacity(0.12))
                            .clipShape(Capsule())
                    }
                    Text("Need a hand at the resort?")
                        .font(.caption)
                        .foregroundStyle(Color.mlrTextMuted)
                }
            }

            // Post a request button
            Button(action: onAsk) {
                Label("Post a request", systemImage: "plus.circle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(Color.mlrPrimary)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)

            Divider()

            // Willing to Help toggle
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Willing to Help")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.mlrText)
                    Text("Get pinged when someone nearby needs a hand")
                        .font(.caption2)
                        .foregroundStyle(Color.mlrTextMuted)
                }

                Spacer()

                Toggle("", isOn: Binding(
                    get: { willingToHelp },
                    set: { _ in
                        guard !isTogglingWilling else { return }
                        Task {
                            isTogglingWilling = true
                            await onToggleWilling()
                            isTogglingWilling = false
                        }
                    }
                ))
                .tint(Color.mlrPrimary)
                .labelsHidden()
                .disabled(isTogglingWilling)
            }
        }
        .padding(14)
        .cardStyle()
    }
}

// MARK: - AskForHelpSheet
// Sheet form for posting a help request.
// Detailed implementation lives in a dedicated file; this stub satisfies
// the HomeView sheet presentation contract.

struct AskForHelpSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppEnvironment.self) private var env

    @State private var category: HelpCategory = .general
    @State private var whatText: String = ""
    @State private var howMany: Int = 1
    @State private var whereText: String = ""
    @State private var isSubmitting = false
    @State private var submitError: String? = nil

    private let charLimit = 200

    var body: some View {
        NavigationStack {
            Form {
                Section("Type of help") {
                    Picker("Category", selection: $category) {
                        ForEach(HelpCategory.allCases, id: \.self) { cat in
                            Text(cat.label).tag(cat)
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section("What do you need?") {
                    ZStack(alignment: .topLeading) {
                        if whatText.isEmpty {
                            Text("Describe what you need…")
                                .foregroundStyle(Color.mlrTextSubtle)
                                .padding(.top, 8)
                                .padding(.leading, 4)
                        }
                        TextEditor(text: $whatText)
                            .frame(minHeight: 80)
                    }
                    HStack {
                        Spacer()
                        Text("\(whatText.count)/\(charLimit)")
                            .font(.caption2)
                            .foregroundStyle(whatText.count > charLimit
                                             ? Color.mlrDanger : Color.mlrTextMuted)
                    }
                }

                Section("Details") {
                    Stepper("People needed: \(howMany)", value: $howMany, in: 1...10)
                    TextField("Where at the resort?", text: $whereText)
                }

                if category == .urgent {
                    Section {
                        Label("Urgent requests alert everyone nearby immediately.", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(Color.mlrDanger)
                    }
                }

                if let err = submitError {
                    Section {
                        Text(err)
                            .font(.caption)
                            .foregroundStyle(Color.mlrDanger)
                    }
                }
            }
            .navigationTitle("Ask for Help")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                        } else {
                            Text("Post")
                                .fontWeight(.semibold)
                        }
                    }
                    .disabled(whatText.trimmingCharacters(in: .whitespaces).isEmpty
                              || whatText.count > charLimit
                              || isSubmitting)
                }
            }
        }
    }

    private func submit() async {
        guard let profile = env.currentProfile else { return }
        isSubmitting = true
        submitError = nil
        do {
            try await env.helpService.requestHelp(
                requesterId: profile.id,
                category: category,
                what: whatText,
                howMany: howMany,
                where: whereText.isEmpty ? nil : whereText
            )
            dismiss()
        } catch {
            submitError = "Couldn't post request. Please try again."
        }
        isSubmitting = false
    }
}
