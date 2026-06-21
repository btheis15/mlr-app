import Foundation

// MARK: - Push & Notification Types

enum PushType: String, Codable, CaseIterable {
    case chat
    case alerts
    case birthdays
    case committeeJoin = "committee_join"
    case committeeJoinRequest = "committee_join_request"
    case cabinDecision = "cabin_decision"
    case postTag = "post_tag"
    case postMention = "post_mention"
    case postReply = "post_reply"
    case eventRsvp = "event_rsvp"
    case helpRequest = "help_request"
    case helpResponse = "help_response"
}

enum NotifType: String, Codable, CaseIterable {
    case postComment = "post_comment"
    case postReply = "post_reply"
    case postMention = "post_mention"
    case postTag = "post_tag"
    case postReaction = "post_reaction"
    case newPost = "new_post"
    case chatMention = "chat_mention"
    case committeeJoin = "committee_join"
    case committeeJoinRequest = "committee_join_request"
    case cabinRequest = "cabin_request"
    case cabinDecision = "cabin_decision"
    case eventRsvp = "event_rsvp"
    case helpRequest = "help_request"
    case helpResponse = "help_response"
    case broadcast
}

// MARK: - Profile

struct Profile: Codable, Identifiable, Equatable {
    let id: UUID
    var name: String
    var email: String
    var phone: String?
    var birthday: String?
    var bio: String?
    var avatarUrl: String?
    var venmoHandle: String?
    var zelleHandle: String?
    var appleCashHandle: String?
    var emailAlerts: Bool
    var pushLevel: String?
    var pushTypes: [PushType]
    var notifTypes: [NotifType]
    var pushPrompted: Bool
    var isAdmin: Bool
    var betaTester: Bool
    var willingToHelp: Bool
    var introSeen: Bool
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, name, email, phone, birthday, bio
        case avatarUrl = "avatar_url"
        case venmoHandle = "venmo_handle"
        case zelleHandle = "zelle_handle"
        case appleCashHandle = "apple_cash_handle"
        case emailAlerts = "email_alerts"
        case pushLevel = "push_level"
        case pushTypes = "push_types"
        case notifTypes = "notif_types"
        case pushPrompted = "push_prompted"
        case isAdmin = "is_admin"
        case betaTester = "beta_tester"
        case willingToHelp = "willing_to_help"
        case introSeen = "intro_seen"
        case createdAt = "created_at"
    }

    var displayName: String { name }

    var hasPaymentHandle: Bool {
        venmoHandle != nil || zelleHandle != nil || appleCashHandle != nil
    }

    static let guest = Profile(
        id: UUID(),
        name: "Guest",
        email: "",
        phone: nil,
        birthday: nil,
        bio: nil,
        avatarUrl: nil,
        venmoHandle: nil,
        zelleHandle: nil,
        appleCashHandle: nil,
        emailAlerts: false,
        pushLevel: nil,
        pushTypes: [],
        notifTypes: [],
        pushPrompted: false,
        isAdmin: false,
        betaTester: false,
        willingToHelp: false,
        introSeen: true,
        createdAt: nil
    )
}

// MARK: - Sign-In Log Entry

struct SignInEntry: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let email: String
    let ipAddress: String?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case email
        case ipAddress = "ip_address"
        case createdAt = "created_at"
    }
}
