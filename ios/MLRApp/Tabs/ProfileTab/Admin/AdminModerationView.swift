import SwiftUI

// MARK: - ModerationItem
// A single item in the moderation queue (returned by `moderation_queue` RPC).

struct ModerationItem: Codable, Identifiable, Equatable {
    let id: UUID
    let contentType: String     // "post" | "post_comment"
    let contentId: UUID
    let preview: String
    let reportCount: Int
    var status: String          // "pending" | "visible" | "hidden"
    let createdAt: Date
    let reportedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case contentType  = "content_type"
        case contentId    = "content_id"
        case preview
        case reportCount  = "report_count"
        case status
        case createdAt    = "created_at"
        case reportedAt   = "reported_at"
    }
}

// MARK: - AdminModerationView

struct AdminModerationView: View {
    @Environment(AppEnvironment.self) private var env

    @State private var items: [ModerationItem] = []
    @State private var isLoading = false
    @State private var error: String? = nil
    @State private var actionError: String? = nil

    // MARK: - Body

    var body: some View {
        List {
            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(Color.mlrDanger)
                        .font(.subheadline)
                }
            }

            if let actionError {
                Section {
                    Label(actionError, systemImage: "xmark.circle")
                        .foregroundStyle(Color.mlrWarning)
                        .font(.subheadline)
                }
            }

            if isLoading && items.isEmpty {
                ForEach(0..<4, id: \.self) { _ in
                    moderationSkeleton
                }
            } else if !isLoading && items.isEmpty && error == nil {
                emptyState
            } else {
                ForEach(items) { item in
                    ModerationItemRow(
                        item: item,
                        onApprove: { Task { await approve(item) } },
                        onRemove:  { Task { await remove(item) } }
                    )
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Content Review")
        .navigationBarTitleDisplayMode(.large)
        .refreshable {
            await loadQueue()
        }
        .task {
            await loadQueue()
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        Section {
            VStack(spacing: 16) {
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(Color.mlrSuccess.opacity(0.6))
                Text("No items in queue")
                    .font(.headline)
                    .foregroundStyle(Color.mlrTextMuted)
                Text("When posts or comments are reported, they'll appear here for review.")
                    .font(.subheadline)
                    .foregroundStyle(Color.mlrTextSubtle)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 48)
            .listRowBackground(Color.clear)
        }
    }

    // MARK: - Skeleton

    private var moderationSkeleton: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 4).fill(Color.mlrCard).frame(width: 60, height: 20)
                RoundedRectangle(cornerRadius: 4).fill(Color.mlrCard).frame(width: 80, height: 20)
            }
            RoundedRectangle(cornerRadius: 4).fill(Color.mlrCard).frame(height: 14).frame(maxWidth: .infinity)
            RoundedRectangle(cornerRadius: 4).fill(Color.mlrCard).frame(height: 14).frame(maxWidth: 200)
        }
        .padding(.vertical, 8)
    }

    // MARK: - Data

    @MainActor
    private func loadQueue() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let result: [ModerationItem] = try await supabase
                .rpc("moderation_queue")
                .execute()
                .value
            items = result
        } catch {
            self.error = "Couldn't load review queue."
        }
    }

    @MainActor
    private func approve(_ item: ModerationItem) async {
        actionError = nil
        do {
            try await supabase
                .rpc("set_content_status", params: [
                    "p_content_type": item.contentType,
                    "p_content_id": item.contentId.uuidString,
                    "p_status": "visible"
                ])
                .execute()
            items.removeAll { $0.id == item.id }
        } catch {
            actionError = "Couldn't approve item."
        }
    }

    @MainActor
    private func remove(_ item: ModerationItem) async {
        actionError = nil
        do {
            try await supabase
                .rpc("set_content_status", params: [
                    "p_content_type": item.contentType,
                    "p_content_id": item.contentId.uuidString,
                    "p_status": "hidden"
                ])
                .execute()
            items.removeAll { $0.id == item.id }
        } catch {
            actionError = "Couldn't remove item."
        }
    }
}

// MARK: - ModerationItemRow

private struct ModerationItemRow: View {
    let item: ModerationItem
    let onApprove: () -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header: content type badge + report count + date
            HStack(spacing: 8) {
                typeBadge
                reportBadge
                Spacer()
                Text(MLRFormat.relativeTime(item.reportedAt ?? item.createdAt))
                    .font(.caption2)
                    .foregroundStyle(Color.mlrTextSubtle)
            }

            // Content preview
            Text(item.preview.isEmpty ? "(no content)" : item.preview)
                .font(.system(size: 14))
                .foregroundStyle(Color.mlrText)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.mlrCard)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            // Action buttons
            HStack(spacing: 10) {
                Button(action: onApprove) {
                    Label("Approve", systemImage: "checkmark.circle.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background(Color.mlrSuccess)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                Button(action: onRemove) {
                    Label("Remove", systemImage: "xmark.circle.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background(Color.mlrDanger)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .padding(.vertical, 10)
    }

    private var typeBadge: some View {
        let label = item.contentType == "post" ? "Post" : "Comment"
        let color = item.contentType == "post" ? Color.mlrInfo : Color.mlrAccent
        return Text(label)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }

    private var reportBadge: some View {
        HStack(spacing: 3) {
            Image(systemName: "flag.fill")
                .font(.system(size: 10))
            Text("\(item.reportCount) report\(item.reportCount == 1 ? "" : "s")")
                .font(.system(size: 11, weight: .semibold))
        }
        .foregroundStyle(Color.mlrDanger)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Color.mlrDanger.opacity(0.1))
        .clipShape(Capsule())
    }
}

#Preview {
    NavigationStack {
        AdminModerationView()
    }
    .environment(AppEnvironment())
}
