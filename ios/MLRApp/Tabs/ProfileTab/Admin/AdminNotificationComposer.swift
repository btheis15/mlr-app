import SwiftUI

// MARK: - BroadcastAudience UI extensions
// BroadcastAudience is defined in NotificationsService.swift.
// Add CaseIterable + Identifiable conformances and UI helpers here.

extension BroadcastAudience: CaseIterable, Identifiable {
    public static var allCases: [BroadcastAudience] { [.everyone, .admins] }
    public var id: String { rawValue }

    var label: String {
        switch self {
        case .everyone: return "Everyone"
        case .admins:   return "Admins"
        }
    }

    var icon: String {
        switch self {
        case .everyone: return "person.3.fill"
        case .admins:   return "shield.fill"
        }
    }
}

// MARK: - AdminNotificationComposer

struct AdminNotificationComposer: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    @State private var title: String = ""
    @State private var messageBody: String = ""
    @State private var audience: BroadcastAudience = .everyone
    @State private var alsoBanner: Bool = false
    @State private var bannerExpiry: ExpiryWindow = .sixHours
    @State private var isSending = false
    @State private var error: String? = nil
    @State private var sent = false

    private var canSend: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Form {
                // Compose fields
                Section("Message") {
                    TextField("Title (required)", text: $title)
                        .font(.system(size: 16, weight: .medium))

                    ZStack(alignment: .topLeading) {
                        if messageBody.isEmpty {
                            Text("Body (optional)")
                                .foregroundStyle(Color.mlrTextSubtle)
                                .padding(.top, 8)
                                .padding(.leading, 4)
                        }
                        TextEditor(text: $messageBody)
                            .frame(minHeight: 80)
                    }
                }

                // Audience picker
                Section("Audience") {
                    ForEach(BroadcastAudience.allCases) { option in
                        Button {
                            audience = option
                        } label: {
                            HStack {
                                Label(option.label, systemImage: option.icon)
                                    .foregroundStyle(Color.mlrText)
                                Spacer()
                                if audience == option {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(Color.mlrPrimary)
                                        .fontWeight(.semibold)
                                }
                            }
                        }
                    }
                }

                // Banner option — only available for Everyone
                if audience == .everyone {
                    Section {
                        Toggle(isOn: $alsoBanner) {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Also post as banner")
                                    Text("Visible at the top of the app to all visitors")
                                        .font(.caption)
                                        .foregroundStyle(Color.mlrTextMuted)
                                }
                            } icon: {
                                Image(systemName: "megaphone.fill")
                                    .foregroundStyle(Color.mlrAccent)
                            }
                        }
                        .tint(Color.mlrPrimary)

                        if alsoBanner {
                            Picker("Banner expires", selection: $bannerExpiry) {
                                ForEach(ExpiryWindow.allCases) { w in
                                    Text(w.label).tag(w)
                                }
                            }
                            .pickerStyle(.menu)
                        }
                    }
                }

                // Preview
                Section("Preview") {
                    notificationPreview
                }

                // Error
                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.circle")
                            .foregroundStyle(Color.mlrDanger)
                            .font(.subheadline)
                    }
                }

                // Send button
                Section {
                    Button {
                        Task { await sendNotification() }
                    } label: {
                        HStack {
                            Spacer()
                            if isSending {
                                ProgressView().tint(.white)
                            } else {
                                Label("Send to \(audience.label)", systemImage: "paperplane.fill")
                                    .fontWeight(.semibold)
                                    .foregroundStyle(.white)
                            }
                            Spacer()
                        }
                    }
                    .frame(height: 48)
                    .background(canSend ? Color.mlrPrimary : Color.mlrCard)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                    .disabled(!canSend || isSending)
                }
                .listRowBackground(Color.clear)
            }
            .navigationTitle("Send Notification")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(Color.mlrPrimary)
                }
            }
            .alert("Sent!", isPresented: $sent) {
                Button("Done") { dismiss() }
            } message: {
                Text("Notification sent to \(audience.label.lowercased()).")
            }
        }
    }

    // MARK: - Preview

    private var notificationPreview: some View {
        HStack(spacing: 12) {
            Image(systemName: "bell.badge.fill")
                .font(.system(size: 20))
                .foregroundStyle(Color.mlrPrimary)
                .frame(width: 36, height: 36)
                .background(Color.mlrPrimaryLight)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 3) {
                Text(title.isEmpty ? "Title" : title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.mlrText)
                    .lineLimit(2)

                if !messageBody.isEmpty {
                    Text(messageBody)
                        .font(.caption)
                        .foregroundStyle(Color.mlrTextMuted)
                        .lineLimit(2)
                }

                HStack(spacing: 4) {
                    Image(systemName: audience.icon)
                        .font(.system(size: 10))
                    Text("→ \(audience.label)")
                        .font(.caption2)
                }
                .foregroundStyle(Color.mlrTextSubtle)
            }
            Spacer()
        }
        .padding(12)
        .background(Color.mlrCard)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
        .listRowBackground(Color.clear)
    }

    // MARK: - Send

    @MainActor
    private func sendNotification() async {
        guard canSend else { return }
        isSending = true
        error = nil
        defer { isSending = false }

        let trimmedTitle = title.trimmingCharacters(in: .whitespaces)
        let trimmedBody  = messageBody.trimmingCharacters(in: .whitespaces)
        let postBanner   = audience == .everyone && alsoBanner

        do {
            // Use the existing service method
            try await env.notificationsService.sendBroadcast(
                title: trimmedTitle,
                body: trimmedBody.isEmpty ? nil : trimmedBody,
                audience: audience,
                mirrorBanner: postBanner
            )

            // If mirroring a banner, also insert directly into announcements
            // (sendBroadcast with mirrorBanner may handle this server-side;
            //  insert here only if we need a custom expiry)
            if postBanner {
                let fmt = ISO8601DateFormatter()
                try await supabase
                    .from("announcements")
                    .insert([
                        "title": trimmedTitle,
                        "body": trimmedBody,
                        "kind": AnnouncementKind.info.rawValue,
                        "expires_at": fmt.string(from: bannerExpiry.expiresAt)
                    ])
                    .execute()
            }

            sent = true
        } catch {
            self.error = "Couldn't send notification. Please try again."
        }
    }
}

#Preview {
    AdminNotificationComposer()
        .environment(AppEnvironment())
}
