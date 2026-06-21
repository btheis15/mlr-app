import SwiftUI

// MARK: - ExpiryWindow
// Available expiry presets for an announcement.

enum ExpiryWindow: String, CaseIterable, Identifiable {
    case sixHours   = "6h"
    case oneDay     = "24h"
    case threeDays  = "3d"
    case sevenDays  = "7d"
    case thirtyDays = "30d"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .sixHours:   return "6 hours (default)"
        case .oneDay:     return "24 hours"
        case .threeDays:  return "3 days"
        case .sevenDays:  return "7 days"
        case .thirtyDays: return "30 days"
        }
    }

    var seconds: TimeInterval {
        switch self {
        case .sixHours:   return 6 * 3600
        case .oneDay:     return 24 * 3600
        case .threeDays:  return 3 * 86400
        case .sevenDays:  return 7 * 86400
        case .thirtyDays: return 30 * 86400
        }
    }

    var expiresAt: Date { Date.now.addingTimeInterval(seconds) }
}

// MARK: - AdminAlertComposer

struct AdminAlertComposer: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    @State private var title: String = ""
    @State private var body: String = ""
    @State private var kind: AnnouncementKind = .info
    @State private var expiry: ExpiryWindow = .sixHours
    @State private var mirrorToNotif: Bool = false
    @State private var isPosting = false
    @State private var error: String? = nil
    @State private var posted = false

    private var canPost: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Form {
                // Compose fields
                Section("Announcement") {
                    TextField("Title (required)", text: $title)
                        .font(.system(size: 16, weight: .medium))

                    ZStack(alignment: .topLeading) {
                        if body.isEmpty {
                            Text("Body (optional)")
                                .foregroundStyle(Color.mlrTextSubtle)
                                .padding(.top, 8)
                                .padding(.leading, 4)
                        }
                        TextEditor(text: $body)
                            .frame(minHeight: 80)
                    }
                }

                // Kind picker
                Section("Style") {
                    Picker("Kind", selection: $kind) {
                        Label("Info", systemImage: "info.circle.fill").tag(AnnouncementKind.info)
                        Label("Warning", systemImage: "exclamationmark.triangle.fill").tag(AnnouncementKind.warning)
                        Label("Urgent", systemImage: "exclamationmark.octagon.fill").tag(AnnouncementKind.urgent)
                        Label("Fest", systemImage: "star.fill").tag(AnnouncementKind.fest)
                    }
                    .pickerStyle(.menu)
                    .tint(kindColor(kind))
                }

                // Expiry picker
                Section("Auto-hide after") {
                    Picker("Expiry", selection: $expiry) {
                        ForEach(ExpiryWindow.allCases) { window in
                            Text(window.label).tag(window)
                        }
                    }
                    .pickerStyle(.menu)
                }

                // Mirror option
                Section {
                    Toggle(isOn: $mirrorToNotif) {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Also send as notification")
                                Text("Sends to every member's Activity feed")
                                    .font(.caption)
                                    .foregroundStyle(Color.mlrTextMuted)
                            }
                        } icon: {
                            Image(systemName: "bell.badge")
                                .foregroundStyle(Color.mlrPrimary)
                        }
                    }
                    .tint(Color.mlrPrimary)
                }

                // Preview
                Section("Preview") {
                    announcementPreview
                }

                // Error
                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.circle")
                            .foregroundStyle(Color.mlrDanger)
                            .font(.subheadline)
                    }
                }

                // Post button
                Section {
                    Button {
                        Task { await postAnnouncement() }
                    } label: {
                        HStack {
                            Spacer()
                            if isPosting {
                                ProgressView()
                                    .tint(.white)
                            } else {
                                Label("Post Announcement", systemImage: "megaphone.fill")
                                    .fontWeight(.semibold)
                                    .foregroundStyle(.white)
                            }
                            Spacer()
                        }
                    }
                    .frame(height: 48)
                    .background(canPost ? Color.mlrPrimary : Color.mlrCard)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                    .disabled(!canPost || isPosting)
                }
                .listRowBackground(Color.clear)
            }
            .navigationTitle("Post Announcement")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(Color.mlrPrimary)
                }
            }
            .alert("Posted!", isPresented: $posted) {
                Button("Done") { dismiss() }
            } message: {
                Text("Your announcement will appear at the top of the app for all visitors.")
            }
        }
    }

    // MARK: - Announcement preview

    private var announcementPreview: some View {
        HStack(spacing: 10) {
            Image(systemName: kindIcon(kind))
                .font(.system(size: 15))
                .foregroundStyle(kindColor(kind))

            VStack(alignment: .leading, spacing: 2) {
                Text(title.isEmpty ? "Title" : title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.mlrText)
                    .lineLimit(2)

                if !body.isEmpty {
                    Text(body)
                        .font(.caption)
                        .foregroundStyle(Color.mlrTextMuted)
                        .lineLimit(3)
                }

                Text("Expires \(expiryDescription)")
                    .font(.caption2)
                    .foregroundStyle(Color.mlrTextSubtle)
            }

            Spacer()

            Text("✕")
                .font(.caption)
                .foregroundStyle(Color.mlrTextSubtle)
        }
        .padding(12)
        .background(kindColor(kind).opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(kindColor(kind).opacity(0.25), lineWidth: 1)
        )
        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
        .listRowBackground(Color.clear)
    }

    private var expiryDescription: String {
        let fmt = DateFormatter()
        fmt.dateStyle = .short
        fmt.timeStyle = .short
        return fmt.string(from: expiry.expiresAt)
    }

    // MARK: - Kind helpers

    private func kindColor(_ k: AnnouncementKind) -> Color {
        switch k {
        case .info:    return Color.mlrInfo
        case .warning: return Color.mlrWarning
        case .urgent:  return Color.mlrDanger
        case .fest:    return Color.mlrFest
        }
    }

    private func kindIcon(_ k: AnnouncementKind) -> String {
        switch k {
        case .info:    return "info.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .urgent:  return "exclamationmark.octagon.fill"
        case .fest:    return "star.fill"
        }
    }

    // MARK: - Post

    @MainActor
    private func postAnnouncement() async {
        guard canPost else { return }
        isPosting = true
        error = nil
        defer { isPosting = false }

        let fmt = ISO8601DateFormatter()
        let params: [String: Any] = [
            "title": title.trimmingCharacters(in: .whitespaces),
            "body": body.trimmingCharacters(in: .whitespaces),
            "kind": kind.rawValue,
            "expires_at": fmt.string(from: expiry.expiresAt)
        ]

        do {
            try await supabase
                .from("announcements")
                .insert(params)
                .execute()

            // Optionally mirror to in-app notifications
            if mirrorToNotif {
                try await supabase
                    .rpc("send_broadcast_notification", params: [
                        "p_title": title.trimmingCharacters(in: .whitespaces),
                        "p_body": body.trimmingCharacters(in: .whitespaces),
                        "p_audience": "everyone"
                    ])
                    .execute()
            }

            posted = true
        } catch {
            self.error = "Couldn't post announcement. Please try again."
        }
    }
}

#Preview {
    AdminAlertComposer()
        .environment(AppEnvironment())
}
