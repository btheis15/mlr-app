import SwiftUI

// MARK: - NotificationRow
// Reusable row for the Activity feed. Shows a left-strip accent bar when
// the notification is unread, an actor avatar (if available), title,
// optional body preview, and a relative timestamp.

struct NotificationRow: View {
    let notification: AppNotification

    // MARK: - Kind → accent color

    var accentColor: Color {
        switch notification.kind {
        case .broadcast:
            return Color.mlrPrimary
        case .helpRequest, .helpResponse:
            return Color.mlrDanger
        case .cabinDecision, .cabinRequest:
            return Color.mlrWarning
        case .chatMention, .postMention:
            return Color.mlrInfo
        case .committeeJoin, .committeeJoinRequest:
            return Color.mlrAccent
        default:
            return Color.mlrPrimary
        }
    }

    private var isUnread: Bool { notification.isUnread }

    // MARK: - Body

    var body: some View {
        HStack(alignment: .top, spacing: 0) {

            // Unread accent strip
            Rectangle()
                .fill(isUnread ? accentColor : Color.clear)
                .frame(width: 3)
                .clipShape(Capsule())
                .padding(.trailing, 10)

            // Actor avatar
            actorAvatar

            // Text content
            VStack(alignment: .leading, spacing: 3) {
                // Title — bold when unread
                Text(notification.title)
                    .font(isUnread
                          ? .system(size: 15, weight: .semibold)
                          : .system(size: 15, weight: .regular))
                    .foregroundStyle(Color.mlrText)
                    .fixedSize(horizontal: false, vertical: true)

                // Optional body preview
                if let body = notification.body, !body.isEmpty {
                    Text(body)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.mlrTextMuted)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                // Relative timestamp + kind badge
                HStack(spacing: 6) {
                    Text(MLRFormat.relativeTime(notification.createdAt))
                        .font(.system(size: 12))
                        .foregroundStyle(Color.mlrTextSubtle)

                    kindBadge
                }
                .padding(.top, 2)
            }

            Spacer(minLength: 0)

            // Unread dot indicator
            if isUnread {
                Circle()
                    .fill(accentColor)
                    .frame(width: 8, height: 8)
                    .padding(.top, 4)
                    .padding(.leading, 8)
            }
        }
        .padding(.vertical, 10)
        .padding(.trailing, 16)
        .contentShape(Rectangle())
    }

    // MARK: - Actor Avatar

    @ViewBuilder
    private var actorAvatar: some View {
        if let urlStr = notification.actorAvatarUrl,
           let url = URL(string: urlStr) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                        .frame(width: 36, height: 36)
                        .clipShape(Circle())
                case .failure, .empty:
                    placeholderAvatar
                @unknown default:
                    placeholderAvatar
                }
            }
            .padding(.trailing, 10)
        } else {
            kindIconAvatar
                .padding(.trailing, 10)
        }
    }

    private var placeholderAvatar: some View {
        Circle()
            .fill(accentColor.opacity(0.15))
            .frame(width: 36, height: 36)
            .overlay {
                Text(notification.actorName?.prefix(1).uppercased() ?? "?")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(accentColor)
            }
    }

    private var kindIconAvatar: some View {
        Circle()
            .fill(accentColor.opacity(0.12))
            .frame(width: 36, height: 36)
            .overlay {
                Image(systemName: kindIcon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(accentColor)
            }
    }

    // MARK: - Kind icon

    private var kindIcon: String {
        switch notification.kind {
        case .broadcast:            return "megaphone.fill"
        case .helpRequest:          return "hand.raised.fill"
        case .helpResponse:         return "figure.walk"
        case .cabinRequest:         return "house.lodge.fill"
        case .cabinDecision:        return "house.lodge.fill"
        case .postComment:          return "bubble.left.fill"
        case .postReply:            return "arrowshape.turn.up.left.fill"
        case .postMention:          return "at"
        case .postTag:              return "tag.fill"
        case .postReaction:         return "heart.fill"
        case .newPost:              return "rectangle.stack.fill"
        case .chatMention:          return "at"
        case .committeeJoin:        return "person.badge.plus"
        case .committeeJoinRequest: return "person.badge.clock"
        case .eventRsvp:            return "calendar.badge.checkmark"
        }
    }

    // MARK: - Kind badge

    @ViewBuilder
    private var kindBadge: some View {
        let label = kindLabel
        if !label.isEmpty {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(accentColor)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(accentColor.opacity(0.1))
                .clipShape(Capsule())
        }
    }

    private var kindLabel: String {
        switch notification.kind {
        case .broadcast:            return "Announcement"
        case .helpRequest:          return "Help Request"
        case .helpResponse:         return "Help Response"
        case .cabinRequest:         return "Cabin Request"
        case .cabinDecision:        return "Cabin"
        case .postComment:          return "Comment"
        case .postReply:            return "Reply"
        case .postMention:          return "Mention"
        case .postTag:              return "Tagged"
        case .postReaction:         return "Reaction"
        case .newPost:              return "New Post"
        case .chatMention:          return "Chat"
        case .committeeJoin:        return "Committee"
        case .committeeJoinRequest: return "Join Request"
        case .eventRsvp:            return "RSVP"
        }
    }
}

#Preview {
    List {
        NotificationRow(notification: AppNotification(
            id: UUID(),
            userId: UUID(),
            kind: .broadcast,
            title: "Dock cleanup Saturday 9am",
            body: "Bring work gloves — we'll be pulling the diving platform.",
            targetType: nil,
            targetId: nil,
            actorName: "Sarah T.",
            actorAvatarUrl: nil,
            seenAt: nil,
            readAt: nil,
            expiresAt: nil,
            createdAt: Date().addingTimeInterval(-3600)
        ))
        NotificationRow(notification: AppNotification(
            id: UUID(),
            userId: UUID(),
            kind: .helpRequest,
            title: "Help needed: moving logs",
            body: "Need 2 people near cabin 4",
            targetType: nil,
            targetId: nil,
            actorName: "Jim K.",
            actorAvatarUrl: nil,
            seenAt: Date(),
            readAt: Date(),
            expiresAt: nil,
            createdAt: Date().addingTimeInterval(-86400)
        ))
    }
    .listStyle(.plain)
}
