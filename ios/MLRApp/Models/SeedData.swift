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

// MARK: - Schedule Item Seed Data

extension ScheduleItem {
    static let seed: [ScheduleItem] = [
        // Sunday Aug 2 — Arrival Day
        ScheduleItem(
            id: "sun-bonfire",
            day: "Sunday",
            time: "7:00 PM",
            title: "Opening Bonfire & Potluck",
            location: "Main Fire Pit · Lakeside",
            description: "Kick off the week together around the fire. Bring a dish to share — drinks provided. This is the unofficial start of everything.",
            isPrivate: false,
            leads: ["Mark Henderson", "Sue Garcia"]
        ),
        // Monday Aug 3
        ScheduleItem(
            id: "mon-fishing",
            day: "Monday",
            time: "6:00 AM",
            title: "Fishing Tournament",
            location: "Dock A · Muskellunge Lake",
            description: "Annual muskellunge fishing tournament. All ages welcome. Prizes for biggest catch and youngest angler. Bring your own gear or borrow from the resort.",
            isPrivate: false,
            leads: ["Jim Peterson", "Ray Theis"]
        ),
        ScheduleItem(
            id: "mon-kayak",
            day: "Monday",
            time: "2:00 PM",
            title: "Kayak & Canoe Relay",
            location: "Beach Area",
            description: "Team relay race across the cove. Sign up at the beach — teams of 3.",
            isPrivate: false,
            leads: ["Amy Murphy"]
        ),
        // Tuesday Aug 4
        ScheduleItem(
            id: "tue-scavenger",
            day: "Tuesday",
            time: "10:00 AM",
            title: "Scavenger Hunt",
            location: "Resort Grounds — meet at Pavilion",
            description: "The annual family scavenger hunt across the resort. Teams of 4–6, mixed ages. Clues hidden throughout the grounds, woods, and lakefront. Prizes for the top 3 teams.",
            isPrivate: false,
            leads: ["Lisa Garcia", "Tom Henderson"]
        ),
        ScheduleItem(
            id: "tue-golf",
            day: "Tuesday",
            time: "1:00 PM",
            title: "Golf Outing",
            location: "Tomahawk Golf Club · 15 min from resort",
            description: "Optional golf outing for those who want to get a round in. Contact the lead to carpool.",
            isPrivate: true,
            leads: ["Dan Peterson"]
        ),
        // Wednesday Aug 5
        ScheduleItem(
            id: "wed-olympics",
            day: "Wednesday",
            time: "11:00 AM",
            title: "Family Olympics",
            location: "Back Field & Beach",
            description: "Annual Family Olympics — tug of war, egg toss, three-legged race, and more. All ages compete. Medals awarded. Teams TBD morning of.",
            isPrivate: false,
            leads: ["Mark Henderson", "Amy Murphy", "Lisa Garcia"]
        ),
        // Thursday Aug 6
        ScheduleItem(
            id: "thu-boat",
            day: "Thursday",
            time: "9:00 AM",
            title: "Pontoon Cruise",
            location: "Dock B — all pontoons",
            description: "Morning lake cruise on the pontoons. Snacks and coolers welcome. Back by noon.",
            isPrivate: true,
            leads: ["Ray Theis"]
        ),
        ScheduleItem(
            id: "thu-talent",
            day: "Thursday",
            time: "7:30 PM",
            title: "Talent Show",
            location: "Pavilion Stage",
            description: "Family talent show — sign up by dinner. All acts welcome: music, comedy, impersonations, skits. Judges are the under-10 crew.",
            isPrivate: false,
            leads: ["Sue Garcia", "Amy Murphy"]
        ),
        // Friday Aug 7
        ScheduleItem(
            id: "fri-photo",
            day: "Friday",
            time: "10:00 AM",
            title: "Family Portrait Session",
            location: "Lakefront Dock",
            description: "Annual family photo — whole group and by household. Wear your Fest shirt if you have one. A professional photographer will be on-site.",
            isPrivate: false,
            leads: ["Lisa Garcia"]
        ),
        ScheduleItem(
            id: "fri-auction",
            day: "Friday",
            time: "4:00 PM",
            title: "Silent Auction & Raffle",
            location: "Pavilion",
            description: "Raise funds for next year's Fest. Donated items and experiences up for bid. Raffle tickets $5 each.",
            isPrivate: false,
            leads: ["Mark Henderson", "Tom Henderson"]
        ),
        // Saturday Aug 8 — Last Day
        ScheduleItem(
            id: "sat-breakfast",
            day: "Saturday",
            time: "9:00 AM",
            title: "Grand Farewell Breakfast",
            location: "Pavilion — main hall",
            description: "Last morning together — a big spread before everyone hits the road. Lingerers welcome through noon.",
            isPrivate: false,
            leads: ["Sue Garcia", "Ray Theis"]
        ),
        // Anytime
        ScheduleItem(
            id: "anytime-scavenger",
            day: "Anytime",
            time: "Any time",
            title: "Mini Scavenger Hunt",
            location: nil,
            description: "A solo or small-group hunt you can do any time during the week. Pick up a clue sheet at the check-in table.",
            isPrivate: false,
            leads: []
        ),
        ScheduleItem(
            id: "anytime-volleyball",
            day: "Anytime",
            time: "Any time",
            title: "Volleyball & Horseshoes",
            location: "Back Field",
            description: "Nets and horseshoe pits are set up all week. Grab whoever's around and play.",
            isPrivate: false,
            leads: []
        ),
        ScheduleItem(
            id: "anytime-smores",
            day: "Anytime",
            time: "After dark",
            title: "S'mores at the Fire Pit",
            location: "Main Fire Pit",
            description: "Supplies are at the fire pit shelter every evening. Help yourself.",
            isPrivate: false,
            leads: []
        ),
    ]
}

// MARK: - Fest Dinner Seed Data

extension FestDinner {
    static let seed: [FestDinner] = [
        FestDinner(
            id: "dinner-sun",
            day: "Sunday",
            title: "Arrival Potluck",
            chef: "Everyone",
            menu: "Bring a dish to share\nGrilled brats & burgers (provided)\nLemonade & iced tea\nWatermelon",
            location: "Pavilion Tables",
            time: "6:30 PM",
            crew: []
        ),
        FestDinner(
            id: "dinner-mon",
            day: "Monday",
            title: "Shore Lunch Cookout",
            chef: "Jim Peterson",
            menu: "Fresh-caught fish (from the tournament)\nColeslaw\nCorn on the cob\nBaked beans\nCornbread",
            location: "Lakeside Grill Area",
            time: "5:30 PM",
            crew: ["Ray Theis", "Dan Peterson", "Tom Henderson"]
        ),
        FestDinner(
            id: "dinner-tue",
            day: "Tuesday",
            title: "Italian Night",
            chef: "Sue Garcia",
            menu: "Lasagna (meat & veggie)\nCaesar salad\nGarlic bread\nTiramisu",
            location: "Pavilion Main Hall",
            time: "6:00 PM",
            crew: ["Lisa Garcia", "Amy Murphy"]
        ),
        FestDinner(
            id: "dinner-wed",
            day: "Wednesday",
            title: "Wisconsin Bratwurst Fest",
            chef: "Mark Henderson",
            menu: "Beer brats & Johnsonville links\nKraut & grilled onions\nPotato salad\nPretzel rolls\nKey lime pie",
            location: "Back Field Grills",
            time: "5:30 PM",
            crew: ["Tom Henderson", "Dan Peterson"]
        ),
        FestDinner(
            id: "dinner-thu",
            day: "Thursday",
            title: "Taco Bar Night",
            chef: "Amy Murphy",
            menu: "Beef & chicken tacos\nAll the toppings bar\nRice & black beans\nChips & guacamole\nChurros",
            location: "Pavilion Main Hall",
            time: "6:00 PM",
            crew: ["Lisa Garcia", "Sue Garcia"]
        ),
        FestDinner(
            id: "dinner-fri",
            day: "Friday",
            title: "Farewell Fish Fry",
            chef: "Ray Theis",
            menu: "Friday fish fry — walleye & perch\nFrench fries\nColeslaw\nRye bread & lemon\nFunnel cake for dessert",
            location: "Lakeside Pavilion",
            time: "6:30 PM",
            crew: ["Jim Peterson", "Mark Henderson", "Tom Henderson"]
        ),
        FestDinner(
            id: "dinner-sat",
            day: "Saturday",
            title: "Farewell Breakfast (Dinner Leftover Brunch)",
            chef: "Sue Garcia",
            menu: "Pancakes & French toast\nScrambled eggs & bacon\nFresh fruit\nJuice & coffee",
            location: "Pavilion Main Hall",
            time: "9:00 AM",
            crew: ["Amy Murphy", "Lisa Garcia"]
        ),
    ]
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
