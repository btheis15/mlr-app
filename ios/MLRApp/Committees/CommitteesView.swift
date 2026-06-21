import SwiftUI

// MARK: - CommitteesView
// Browse committees. "My committees" highlighted at top, the rest below.
// Join via requestJoin (pending badge shown), tap → CommitteeDetailView.

struct CommitteesView: View {
    @Environment(AppEnvironment.self) private var env

    @State private var hasLoaded = false
    @State private var pendingRequestIds: Set<UUID> = []
    @State private var joiningIds: Set<UUID> = []
    @State private var actionError: String?

    private var committees: [Committee] { env.committeeService.committees }
    private var myMemberships: [CommitteeMember] { env.committeeService.myMemberships }

    private var myCommitteeIds: Set<UUID> {
        Set(myMemberships.map(\.committeeId))
    }

    private var myCommittees: [Committee] {
        committees.filter { myCommitteeIds.contains($0.id) }
    }

    private var otherCommittees: [Committee] {
        committees.filter { !myCommitteeIds.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if env.committeeService.isLoading && !hasLoaded {
                    ScrollView {
                        VStack(spacing: 12) {
                            ForEach(0..<5, id: \.self) { _ in SkeletonCard(height: 90) }
                        }
                        .padding(.vertical, 16)
                    }
                } else if let error = env.committeeService.error, committees.isEmpty {
                    errorState(error)
                } else if committees.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Committees")
            .alert("Couldn't join", isPresented: .constant(actionError != nil)) {
                Button("OK") { actionError = nil }
            } message: {
                Text(actionError ?? "")
            }
            .task {
                guard !hasLoaded else { return }
                await env.committeeService.fetchCommittees()
                if let userId = await env.authService.userId {
                    await env.committeeService.fetchMyMemberships(userId: userId)
                }
                hasLoaded = true
            }
        }
    }

    // MARK: - List

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if !myCommittees.isEmpty {
                    section(title: "My committees", committees: myCommittees, isMember: true)
                }
                section(
                    title: myCommittees.isEmpty ? "All committees" : "Join a committee",
                    committees: otherCommittees,
                    isMember: false
                )
            }
            .padding(.vertical, 16)
        }
        .refreshable {
            await env.committeeService.fetchCommittees()
            if let userId = await env.authService.userId {
                await env.committeeService.fetchMyMemberships(userId: userId)
            }
        }
    }

    private func section(title: String, committees: [Committee], isMember: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: title)
                .padding(.horizontal, 16)
            VStack(spacing: 10) {
                ForEach(committees) { committee in
                    CommitteeRowCard(
                        committee: committee,
                        isMember: isMember,
                        isPending: pendingRequestIds.contains(committee.id),
                        isJoining: joiningIds.contains(committee.id),
                        onJoin: { Task { await join(committee) } }
                    )
                }
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Empty / error

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No committees yet", systemImage: "person.3")
        } description: {
            Text("Committees help organize the work behind the resort and Family Fest.")
        }
    }

    private func errorState(_ message: String) -> some View {
        ContentUnavailableView {
            Label("Couldn't load committees", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Try Again") {
                Task { await env.committeeService.fetchCommittees() }
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.mlrPrimary)
        }
    }

    // MARK: - Join

    private func join(_ committee: Committee) async {
        guard env.isSignedIn else { env.authService.promptSignIn(); return }
        joiningIds.insert(committee.id)
        defer { joiningIds.remove(committee.id) }
        do {
            try await env.committeeService.requestJoin(committeeId: committee.id, note: nil)
            pendingRequestIds.insert(committee.id)
        } catch {
            actionError = "Couldn't send your request. Try again."
            print("[Committees] join error: \(error)")
        }
    }
}

// MARK: - Committee Row Card

private struct CommitteeRowCard: View {
    let committee: Committee
    let isMember: Bool
    let isPending: Bool
    let isJoining: Bool
    let onJoin: () -> Void

    var body: some View {
        NavigationLink {
            CommitteeDetailView(committee: committee)
        } label: {
            HStack(spacing: 14) {
                Text(committee.emoji ?? "📋")
                    .font(.system(size: 30))
                    .frame(width: 48, height: 48)
                    .background(Color.mlrPrimaryLight)
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(committee.name)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color.mlrText)
                        if committee.isPrivate {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 10))
                                .foregroundStyle(Color.mlrTextMuted)
                        }
                    }
                    if let desc = committee.description, !desc.isEmpty {
                        Text(desc)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.mlrTextMuted)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }

                Spacer()

                trailing
            }
            .padding(14)
            .background(Color.mlrCard)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var trailing: some View {
        if isMember {
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.mlrTextSubtle)
        } else if isPending {
            Text("Pending")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.mlrWarning)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.mlrWarning.opacity(0.12))
                .clipShape(Capsule())
        } else {
            Button(action: onJoin) {
                if isJoining {
                    ProgressView().tint(Color.mlrPrimary)
                        .frame(width: 54)
                } else {
                    Text("Join")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(Color.mlrPrimary)
                        .clipShape(Capsule())
                }
            }
            .buttonStyle(.plain)
            .disabled(isJoining)
        }
    }
}

