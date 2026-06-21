import SwiftUI

// MARK: - PeopleDirectoryView
// The member directory: everyone with an account, searchable, each with a
// quick Call / Text / Pay bar + tap-through to their full profile.
// Contact details are gated behind `Protected` for guests.
// Admins additionally get an "Email a group" section (mailto:).

struct PeopleDirectoryView: View {
    @Environment(AppEnvironment.self) private var env

    @State private var members: [Profile] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var searchText = ""
    @State private var selectedMember: Profile?
    @State private var showEmailGroup = false

    private var filteredMembers: [Profile] {
        guard !searchText.isEmpty else { return members }
        let q = searchText.lowercased()
        return members.filter {
            $0.name.lowercased().contains(q) || $0.email.lowercased().contains(q)
        }
    }

    var body: some View {
        Group {
            if isLoading {
                List {
                    Section { SkeletonList(count: 8).listRowInsets(EdgeInsets()) }
                }
                .listStyle(.plain)
            } else if let loadError {
                errorState(loadError)
            } else if members.isEmpty {
                emptyState
            } else {
                memberList
            }
        }
        .navigationTitle("People")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $searchText, prompt: "Search by name or email")
        .toolbar {
            if env.isAdmin && !members.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showEmailGroup = true
                    } label: {
                        Image(systemName: "envelope")
                    }
                    .tint(Color.mlrPrimary)
                }
            }
        }
        .sheet(item: $selectedMember) { member in
            MemberSheetView(member: member)
        }
        .sheet(isPresented: $showEmailGroup) {
            EmailGroupSheet(members: members)
        }
        .task { await load() }
    }

    // MARK: - List

    private var memberList: some View {
        List {
            ForEach(filteredMembers) { member in
                MemberRow(member: member) {
                    selectedMember = member
                }
            }
        }
        .listStyle(.plain)
        .refreshable { await load() }
    }

    // MARK: - Empty / error

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No members yet", systemImage: "person.2")
        } description: {
            Text("People who sign in will show up here.")
        }
    }

    private func errorState(_ message: String) -> some View {
        ContentUnavailableView {
            Label("Couldn't load people", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Try Again") { Task { await load() } }
                .buttonStyle(.borderedProminent)
                .tint(Color.mlrPrimary)
        }
    }

    // MARK: - Load

    private func load() async {
        isLoading = members.isEmpty
        loadError = nil
        do {
            let rows: [Profile] = try await supabase
                .from("profiles")
                .select("*")
                .order("name", ascending: true)
                .execute()
                .value
            members = rows
        } catch {
            loadError = "Check your connection and try again."
            print("[PeopleDirectory] load error: \(error)")
        }
        isLoading = false
    }
}

// MARK: - Member Row

private struct MemberRow: View {
    @Environment(AppEnvironment.self) private var env
    let member: Profile
    let onTap: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Button(action: onTap) {
                HStack(spacing: 12) {
                    AvatarView(profile: member, size: .medium)

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            PrivateName(profile: member, font: .system(size: 16, weight: .semibold))
                            if member.isAdmin {
                                Text("Admin")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(Color.mlrPrimary)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.mlrPrimaryLight)
                                    .clipShape(Capsule())
                            }
                        }
                        if env.isSignedIn, let phone = member.phone, !phone.isEmpty {
                            Text(MLRFormat.phone(phone))
                                .font(.system(size: 13))
                                .foregroundStyle(Color.mlrTextMuted)
                        }
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.mlrTextSubtle)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // Quick action bar — gated for guests
            Protected {
                QuickActionBar(member: member)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Quick Action Bar

private struct QuickActionBar: View {
    let member: Profile

    var body: some View {
        HStack(spacing: 8) {
            if let phone = member.phone, !phone.isEmpty {
                let digits = phone.filter(\.isNumber)
                actionChip("Text", "message.fill", url: "sms://\(digits)")
                actionChip("Call", "phone.fill", url: "tel://\(digits)")
            }
            if let venmo = member.venmoHandle, !venmo.isEmpty {
                let handle = venmo.replacingOccurrences(of: "@", with: "")
                actionChip("Pay", "dollarsign.circle.fill",
                           url: "venmo://users/\(handle)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func actionChip(_ label: String, _ icon: String, url: String) -> some View {
        if let link = URL(string: url) {
            Link(destination: link) {
                Label(label, systemImage: icon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.mlrPrimary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.mlrPrimaryLight)
                    .clipShape(Capsule())
            }
        }
    }
}

// MARK: - Email Group Sheet (admin only)

private struct EmailGroupSheet: View {
    @Environment(\.dismiss) private var dismiss
    let members: [Profile]

    @State private var selectedIds: Set<UUID> = []

    private var selectedEmails: [String] {
        members.filter { selectedIds.contains($0.id) }.map(\.email).filter { !$0.isEmpty }
    }

    private var mailtoURL: URL? {
        guard !selectedEmails.isEmpty else { return nil }
        let to = selectedEmails.joined(separator: ",")
        return URL(string: "mailto:\(to)")
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        if selectedIds.count == members.count {
                            selectedIds.removeAll()
                        } else {
                            selectedIds = Set(members.map(\.id))
                        }
                    } label: {
                        Label(
                            selectedIds.count == members.count ? "Deselect all" : "Select everyone",
                            systemImage: selectedIds.count == members.count ? "circle" : "checkmark.circle.fill"
                        )
                        .foregroundStyle(Color.mlrPrimary)
                    }
                }

                Section {
                    ForEach(members) { member in
                        Button {
                            toggle(member.id)
                        } label: {
                            HStack {
                                Image(systemName: selectedIds.contains(member.id)
                                      ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(selectedIds.contains(member.id)
                                                     ? Color.mlrPrimary : Color.mlrTextSubtle)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(member.name)
                                        .foregroundStyle(Color.mlrText)
                                    Text(member.email)
                                        .font(.caption)
                                        .foregroundStyle(Color.mlrTextMuted)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Email a group")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if let mailtoURL {
                        Link(destination: mailtoURL) {
                            Text("Compose (\(selectedEmails.count))")
                                .fontWeight(.semibold)
                        }
                    } else {
                        Text("Compose")
                            .foregroundStyle(Color.mlrTextSubtle)
                    }
                }
            }
        }
    }

    private func toggle(_ id: UUID) {
        if selectedIds.contains(id) { selectedIds.remove(id) }
        else { selectedIds.insert(id) }
    }
}
