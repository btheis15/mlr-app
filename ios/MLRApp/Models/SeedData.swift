import Foundation

// MARK: - Family Fest Config

struct FamilyFestConfig {
    static let startDate = "2026-08-02"
    static let endDate   = "2026-08-08"
    static let id        = "family-fest-2026"
    static let year      = 2026
}

// MARK: - Schedule Item

struct ScheduleItem: Identifiable {
    let id: String
    let day: String
    let time: String
    let title: String
    let location: String?
    let description: String?
    let isPrivate: Bool
    let leads: [String]
}

// MARK: - Dinner

struct FestDinner: Identifiable {
    let id: String
    let day: String
    let title: String
    let chef: String
    let menu: String
    let location: String?
    let time: String
    let crew: [String]
}

// MARK: - Local Place

struct LocalPlace: Identifiable {
    let id: String
    let name: String
    let category: PlaceCategory
    let phone: String?
    let address: String?
    let website: String?
    let menuUrl: String?
    let orderUrl: String?
    let description: String?

    enum PlaceCategory: String {
        case dining, grocery, activity, marina, medical, golf
    }
}

// MARK: - Activity

struct ResortActivity: Identifiable {
    let id: String
    let category: String
    let title: String
    let description: String
    let icon: String
}

// MARK: - T-Shirt Vote

struct TshirtVoteConfig {
    static let formUrl = "https://forms.gle/PLACEHOLDER"
    static let deadline = "2026-07-15"
    static let rankedChoice = true
    static let minVoterAge = 10
    static let designs: [TshirtDesign] = []
}

struct TshirtDesign: Identifiable {
    let id: String
    let name: String
    let artist: String
    let imageName: String
    let blurb: String
}

// MARK: - Seed Events

extension ResortEvent {
    static let seedEvents: [ResortEvent] = [
        ResortEvent(
            id: "family-fest-2026",
            title: "Family Fest 2026",
            description: "The annual Theis Family gathering at Muskellunge Lake Resort.",
            kind: .familyFest,
            startDate: FamilyFestConfig.startDate,
            endDate: FamilyFestConfig.endDate,
            location: "Muskellunge Lake Resort",
            dayRsvp: true,
            source: .seed
        ),
        ResortEvent(
            id: "work-weekend-spring-2026",
            title: "Spring Work Weekend",
            description: "Annual spring cleanup and maintenance at the resort.",
            kind: .workWeekend,
            startDate: "2026-05-15",
            endDate: "2026-05-17",
            location: "Muskellunge Lake Resort",
            dayRsvp: false,
            source: .seed
        ),
        ResortEvent(
            id: "work-weekend-fall-2026",
            title: "Fall Work Weekend",
            description: "Fall closing and winterization of the resort.",
            kind: .workWeekend,
            startDate: "2026-10-02",
            endDate: "2026-10-04",
            location: "Muskellunge Lake Resort",
            dayRsvp: false,
            source: .seed
        )
    ]
}

// MARK: - Seed Activities

extension ResortActivity {
    static let all: [ResortActivity] = [
        ResortActivity(id: "fishing", category: "Water", title: "Fishing", description: "World-class muskie fishing on Muskellunge Lake. Boats and gear available.", icon: "🎣"),
        ResortActivity(id: "boating", category: "Water", title: "Boating", description: "Explore the lake by pontoon, canoe, or kayak.", icon: "⛵"),
        ResortActivity(id: "swimming", category: "Water", title: "Swimming", description: "Sandy beach and swimming area on the lake.", icon: "🏊"),
        ResortActivity(id: "hunting", category: "Land", title: "Hunting", description: "Deer and turkey hunting on resort grounds. Licenses required.", icon: "🦌"),
        ResortActivity(id: "hiking", category: "Land", title: "Hiking", description: "Trails through the northern Wisconsin woods.", icon: "🥾"),
        ResortActivity(id: "bonfires", category: "Evening", title: "Bonfires", description: "Gather around the fire pit for evening stories and s'mores.", icon: "🔥"),
        ResortActivity(id: "golf", category: "Land", title: "Golf", description: "Several golf courses within 20 minutes of the resort.", icon: "⛳")
    ]
}

// MARK: - Seed Announcements

extension Announcement {
    static let seed: [Announcement] = [
        Announcement(
            id: "welcome-2026",
            title: "Welcome to MLR",
            body: "Est. 1987 · Leo & Dorothy Theis · Tomahawk, WI",
            kind: .info,
            expiresAt: nil,
            createdAt: nil
        )
    ]
}
