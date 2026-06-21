import Foundation
import CoreLocation

// MARK: - Help Request

struct HelpRequest: Codable, Identifiable, Equatable {
    let id: UUID
    let requesterId: UUID
    var requesterName: String
    var category: HelpCategory
    var what: String
    var neededCount: Int
    var whereDescription: String?
    var latitude: Double?
    var longitude: Double?
    var scheduledFor: Date?
    var notifyAll: Bool
    var status: HelpRequestStatus
    var fulfilledAt: Date?
    var createdAt: Date
    var responses: [HelpResponse]

    enum CodingKeys: String, CodingKey {
        case id
        case requesterId = "requester_id"
        case requesterName = "requester_name"
        case category
        case what
        case neededCount = "needed_count"
        case whereDescription = "where_description"
        case latitude, longitude
        case scheduledFor = "scheduled_for"
        case notifyAll = "notify_all"
        case status
        case fulfilledAt = "fulfilled_at"
        case createdAt = "created_at"
        case responses = "help_responses"
    }

    var isCovered: Bool { fulfilledAt != nil }

    var respondersCount: Int { responses.count }

    var coordinate: CLLocationCoordinate2D? {
        guard let lat = latitude, let lon = longitude else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}

enum HelpCategory: String, Codable, CaseIterable {
    case moving
    case setup
    case ride
    case supplies
    case urgent

    var label: String {
        switch self {
        case .moving: return "Moving something"
        case .setup: return "Setting up"
        case .ride: return "Ride / pickup"
        case .supplies: return "Supplies run"
        case .urgent: return "🚨 Urgent"
        }
    }

    var emoji: String {
        switch self {
        case .moving: return "📦"
        case .setup: return "🔧"
        case .ride: return "🚗"
        case .supplies: return "🛒"
        case .urgent: return "🚨"
        }
    }
}

enum HelpRequestStatus: String, Codable {
    case open
    case resolved
    case cancelled
    case withdrawn
}

// MARK: - Help Response

struct HelpResponse: Codable, Identifiable, Equatable {
    let id: UUID
    let requestId: UUID
    let responderId: UUID
    var responderName: String
    var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case requestId = "request_id"
        case responderId = "responder_id"
        case responderName = "responder_name"
        case createdAt = "created_at"
    }
}
