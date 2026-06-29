import SwiftUI

// MARK: - HelpRequestsView
// Shared log of open "Ask for Help" requests. Guests get a SignInWall;
// signed-in members see the full log and can post requests.

struct HelpRequestsView: View {
    @Environment(AppEnvironment.self) private var env

    @State private var hasLoaded = false
    @State private var showAskSheet = false
    @State private var actionInFlight: Set<UUID> = []
    @State private var actionError: String?

    private var requests: [HelpRequest] { env.helpService.openRequests }

    private var myId: UUID? { env.currentProfile?.id }

    var body: some View {
        NavigationStack {
            Group {
                if !env.isSignedIn {
                    SignInWall { listPlaceholder }
                } else {
                    content
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Ask for Help")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                if env.isSignedIn {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showAskSheet = true
                        } label: {
                            Image(systemName: "plus")
                        }
                        .tint(Color.mlrFest)
                    }
                }
            }
            .sheet(isPresented: $showAskSheet) {
                AskForHelpSheet()
            }
            .alert("Something went wrong", isPresented: .constant(actionError != nil)) {
                Button("OK") { actionError = nil }
            } message: {
                Text(actionError ?? "")
            }
            .task {
                guard !hasLoaded else { return }
                await env.helpService.fetchOpenRequests()
                env.helpService.subscribeToRealtime()
                hasLoaded = true
            }
            .onDisappear { env.helpService.unsubscribeFromRealtime() }
        }
    }

    // MARK: - Content

    private var content: some View {
        Group {
            if !hasLoaded && requests.isEmpty {
                ScrollView {
                    VStack(spacing: 12) {
                        ForEach(0..<3, id: \.self) { _ in SkeletonCard(height: 120) }
                    }
                    .padding(.vertical, 16)
                }
            } else if requests.isEmpty {
                emptyState
            } else {
                ScrollView {
                    VStack(spacing: 12) {
                        ForEach(requests) { request in
                            HelpRequestCard(
                                request: request,
                                hasResponded: hasResponded(request),
                                isRequester: request.requesterId == myId,
                                isWorking: actionInFlight.contains(request.id),
                                onRespond: { Task { await respond(request) } },
                                onWithdraw: { Task { await withdraw(request) } },
                                onCancel: { Task { await cancel(request) } }
                            )
                        }
                    }
                    .padding(16)
                }
                .refreshable { await env.helpService.fetchOpenRequests() }
            }
        }
    }

    // MARK: - Empty / placeholder

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No open requests", systemImage: "checkmark.circle")
        } description: {
            Text("All quiet for now. When someone needs a hand, it'll show up here.")
        } actions: {
            Button("Ask for Help") { showAskSheet = true }
                .buttonStyle(.borderedProminent)
                .tint(Color.mlrFest)
        }
    }

    private var listPlaceholder: some View {
        VStack(spacing: 12) {
            ForEach(0..<2, id: \.self) { _ in SkeletonCard(height: 120) }
        }
        .padding(.vertical, 16)
    }

    // MARK: - State helpers

    private func hasResponded(_ request: HelpRequest) -> Bool {
        guard let myId else { return false }
        return request.responses.contains { $0.responderId == myId }
    }

    // MARK: - Actions

    private func respond(_ request: HelpRequest) async {
        actionInFlight.insert(request.id)
        defer { actionInFlight.remove(request.id) }
        do {
            try await env.helpService.respondToHelp(requestId: request.id)
            Haptics.success()
        } catch {
            actionError = "Couldn't mark you on the way. Try again."
        }
    }

    private func withdraw(_ request: HelpRequest) async {
        actionInFlight.insert(request.id)
        defer { actionInFlight.remove(request.id) }
        do {
            try await env.helpService.withdrawHelp(requestId: request.id)
        } catch {
            actionError = "Couldn't withdraw. Try again."
        }
    }

    private func cancel(_ request: HelpRequest) async {
        actionInFlight.insert(request.id)
        defer { actionInFlight.remove(request.id) }
        do {
            try await env.helpService.setStatus(requestId: request.id, status: .cancelled)
        } catch {
            actionError = "Couldn't cancel the request. Try again."
        }
    }
}

// MARK: - Help Request Card

private struct HelpRequestCard: View {
    let request: HelpRequest
    let hasResponded: Bool
    let isRequester: Bool
    let isWorking: Bool
    let onRespond: () -> Void
    let onWithdraw: () -> Void
    let onCancel: () -> Void

    private var isUrgent: Bool { request.category == .urgent }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                Text(request.category.emoji)
                    .font(.system(size: 26))
                VStack(alignment: .leading, spacing: 3) {
                    Text(request.category.label)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(isUrgent ? Color.mlrDanger : Color.mlrTextMuted)
                    Text(request.what)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.mlrText)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                coveredBadge
            }

            // Meta row
            HStack(spacing: 14) {
                Label(request.requesterName, systemImage: "person.fill")
                Label("\(request.respondersCount)/\(request.neededCount) on the way",
                      systemImage: "figure.walk")
            }
            .font(.system(size: 12))
            .foregroundStyle(Color.mlrTextMuted)

            if let location = request.whereDescription, !location.isEmpty {
                Label(location, systemImage: "mappin.and.ellipse")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.mlrTextMuted)
            }

            if let coordinate = request.coordinate {
                HelpRequestMap(coordinate: coordinate,
                               title: request.whereDescription ?? request.what)
            }

            if let when = request.scheduledFor {
                Label(when.formatted(date: .omitted, time: .shortened), systemImage: "clock")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.mlrTextMuted)
            }

            actionRow
        }
        .padding(16)
        .background(isUrgent ? Color.mlrDanger.opacity(0.06) : Color.mlrCard)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(isUrgent ? Color.mlrDanger.opacity(0.3) : .clear, lineWidth: 1)
        )
    }

    private var coveredBadge: some View {
        Text(request.isCovered ? "✅ Covered" : "Open")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(request.isCovered ? Color.mlrSuccess : Color.mlrFest)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background((request.isCovered ? Color.mlrSuccess : Color.mlrFest).opacity(0.14))
            .clipShape(Capsule())
    }

    @ViewBuilder
    private var actionRow: some View {
        if isRequester {
            Button(role: .destructive, action: onCancel) {
                buttonLabel("Cancel my request", color: .mlrDanger, filled: false)
            }
            .buttonStyle(.plain)
            .disabled(isWorking)
        } else if hasResponded {
            Button(action: onWithdraw) {
                buttonLabel("On my way — tap to withdraw", color: .mlrTextMuted, filled: false)
            }
            .buttonStyle(.plain)
            .disabled(isWorking)
        } else if !request.isCovered {
            Button(action: onRespond) {
                if isWorking {
                    ProgressView().tint(.white)
                } else {
                    Text("On my way")
                }
            }
            .buttonStyle(.glassFest)
            .disabled(isWorking)
        }
    }

    private func buttonLabel(_ text: String, color: Color, filled: Bool) -> some View {
        Group {
            if isWorking {
                ProgressView().tint(filled ? .white : color)
            } else {
                Text(text)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(filled ? .white : color)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 11)
        .background(filled ? color : color.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
