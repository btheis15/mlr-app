import Foundation

// MARK: - Family Fest Config

struct FamilyFestConfig {
    static let startDate = "2026-07-27"
    static let endDate   = "2026-07-31"
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

// MARK: - Local Places Seed Data

extension LocalPlace {
    static let all: [LocalPlace] = [
        LocalPlace(
            id: "inshalla",
            name: "Inshalla Country Club",
            category: .golf,
            phone: "+17154533130",
            address: "Tomahawk, WI",
            website: "https://inshallacc.com",
            menuUrl: nil,
            orderUrl: "https://stage.foreupsoftware.com/index.php/booking/19715/2251?booking_class_id=2431&schedule_id=2251#/teetimes",
            description: "Public 18-hole course with a pro shop, driving range, and bar & grill."
        ),
        LocalPlace(
            id: "billy-bobs",
            name: "Billy Bob's Sports Bar & Grill",
            category: .dining,
            phone: "+17154534984",
            address: "Tomahawk, WI",
            website: "https://billybobssportsbarandgrill.com",
            menuUrl: "https://billybobssportsbarandgrill.com/menu/",
            orderUrl: nil,
            description: "Our usual pizza order — plus burgers, baskets, and the big game on."
        ),
        LocalPlace(
            id: "tilted-loon",
            name: "Tilted Loon",
            category: .dining,
            phone: "+17154532768",
            address: "Lake Nokomis · Tomahawk, WI",
            website: "https://www.tiltedloon.com",
            menuUrl: "https://www.tiltedloon.com/menus-1",
            orderUrl: "https://order.toasttab.com/online/tilted_loon",
            description: "Lakeside saloon known for pizza, burgers, and the Friday fish fry — takes online orders."
        ),
        LocalPlace(
            id: "outboards",
            name: "Outboards Bar & Grill",
            category: .dining,
            phone: "+17152243594",
            address: "Downtown Tomahawk, WI",
            website: "https://outboardsbarandgrill.com",
            menuUrl: "https://outboardsbarandgrill.com/menu/",
            orderUrl: nil,
            description: "Downtown bar & grill — fish fry, happy hour, and a full grill menu."
        ),
        LocalPlace(
            id: "sideways",
            name: "Sideways Wine & Craft Beer",
            category: .dining,
            phone: "+17154930826",
            address: "Downtown Tomahawk, WI",
            website: "https://www.sidewayswineandcraftbeer.com",
            menuUrl: "https://www.sidewayswineandcraftbeer.com/menu",
            orderUrl: nil,
            description: "Wine, Wisconsin craft beer, flatbreads, and charcuterie — a relaxed night out."
        ),
    ]
}

// MARK: - Schedule Item Seed Data
// Jul 27 = Monday · Jul 28 = Tuesday · Jul 29 = Wednesday · Jul 30 = Thursday · Jul 31 = Friday

extension ScheduleItem {
    static let seed: [ScheduleItem] = [
        // Monday Jul 27 — Arrival Day
        ScheduleItem(
            id: "arrival",
            day: "Monday",
            time: "3:00 PM",
            title: "Arrival & check-in",
            location: "Main Lodge",
            description: "Roll in, grab your cabin keys at the lodge, and settle the kids. Coolers to the boathouse fridge.",
            isPrivate: false,
            leads: ["Steward Eadric of House Larkspur"]
        ),
        ScheduleItem(
            id: "welcome-bonfire",
            day: "Monday",
            time: "7:30 PM",
            title: "Welcome bonfire & s'mores",
            location: "Lakeside fire pit",
            description: "Kick off the week by the water. Marshmallows and firewood provided — bring a chair and your stories.",
            isPrivate: false,
            leads: ["Baron Aldric of House Thornwood"]
        ),
        // Tuesday Jul 28
        ScheduleItem(
            id: "pancake-breakfast",
            day: "Tuesday",
            time: "8:00 AM",
            title: "Pancake breakfast",
            location: "Lodge deck",
            description: "Grandpa's famous blueberry pancakes. Coffee's on by 7:30.",
            isPrivate: false,
            leads: ["Master Tobias of House Fenwick"]
        ),
        ScheduleItem(
            id: "pontoon-parade",
            day: "Tuesday",
            time: "1:00 PM",
            title: "Pontoon parade",
            location: "Main dock",
            description: "Deck out the pontoons and cruise the bay. Best-decorated boat wins the golden paddle.",
            isPrivate: false,
            leads: ["Captain Rowan of House Eldermoor"]
        ),
        // Wednesday Jul 29
        ScheduleItem(
            id: "musky-tournament",
            day: "Wednesday",
            time: "6:00 AM",
            title: "Musky fishing tournament",
            location: "North bay",
            description: "The big one. Two-person boats, catch-and-release, biggest musky takes the trophy. Early start — coffee at the dock.",
            isPrivate: false,
            leads: ["Master Bartholomew of House Eldermoor"]
        ),
        ScheduleItem(
            id: "kids-olympics",
            day: "Wednesday",
            time: "10:00 AM",
            title: "Kids' lake olympics",
            location: "Swim beach",
            description: "Cannonball contest, sandcastle build-off, and the legendary tube relay.",
            isPrivate: false,
            leads: ["Lady Wynne of House Larkspur"]
        ),
        // Thursday Jul 30
        ScheduleItem(
            id: "cousins-cookout",
            day: "Thursday",
            time: "5:30 PM",
            title: "Cousins' cookout (potluck)",
            location: "Pavilion",
            description: "Everyone brings a dish — see the Crew tab for who's got what. Grill fired up at 5.",
            isPrivate: false,
            leads: ["Goodwife Maren of House Hollowbrook"]
        ),
        ScheduleItem(
            id: "talent-show",
            day: "Thursday",
            time: "7:00 PM",
            title: "Family talent show",
            location: "Lodge great room",
            description: "Sign up at the lodge. Acts of all kinds welcome — the cheesier the better.",
            isPrivate: false,
            leads: ["Bard Percival of House Wyndmere"]
        ),
        // Friday Jul 31 — Last Day
        ScheduleItem(
            id: "group-photo",
            day: "Friday",
            time: "11:00 AM",
            title: "Big group photo",
            location: "Lodge front steps",
            description: "Everyone, all of us, matching-ish shirts. Don't be late!",
            isPrivate: false,
            leads: ["Dame Cecily of House Brightwater"]
        ),
        ScheduleItem(
            id: "fireworks",
            day: "Friday",
            time: "9:30 PM",
            title: "Fireworks over the lake",
            location: "Lakeside lawn",
            description: "The grand finale. Blankets out, lights down, look up.",
            isPrivate: false,
            leads: ["Sir Reginald of House Pemberlye"]
        ),
        // Anytime
        ScheduleItem(
            id: "scavenger-hunt",
            day: "Anytime",
            time: "Any time",
            title: "Family Fest scavenger hunt",
            location: "Pick up your card at the Main Lodge",
            description: "Track down hidden landmarks & oddities around the lake — any time, all week. Pick up a hunt card at the lodge, then find each spot at your own pace — solo, as a family, or as a house. Finish any day and turn it in at the lodge for a prize at the farewell BBQ.",
            isPrivate: false,
            leads: []
        ),
    ]
}

// MARK: - Fest Dinner Seed Data
// Jul 27 = Monday · Jul 28 = Tuesday · Jul 29 = Wednesday · Jul 30 = Thursday · Jul 31 = Friday

extension FestDinner {
    static let seed: [FestDinner] = [
        FestDinner(
            id: "d-mon",
            day: "Monday",
            title: "The Welcoming Feast",
            chef: "Baron Aldric of House Thornwood",
            menu: "Flame-charred sausages & beef rounds of the realm, fire-roasted corn, and the Baron's legendary potato salad.",
            location: "Lakeside Pavilion",
            time: "6:00 PM",
            crew: ["House Thornwood", "The Ravenshire Clan", "House Larkspur"]
        ),
        FestDinner(
            id: "d-tue",
            day: "Tuesday",
            title: "Ye Olde Pizza Forge",
            chef: "Dame Cecily of House Brightwater",
            menu: "Wood-fired hand pies & flatbreads from the dock forge, a garden-greens salad, and lemon ices for the squires.",
            location: "Main Dock",
            time: "6:30 PM",
            crew: ["House Brightwater", "The Wyndmere Troupe"]
        ),
        FestDinner(
            id: "d-wed",
            day: "Wednesday",
            title: "Dragonscale Fish Fry",
            chef: "Master Bartholomew of House Eldermoor",
            menu: "Beer-battered walleye from the day's catch, golden hush puppies, and slaw of the realm.",
            location: "Boathouse",
            time: "5:30 PM",
            crew: ["House Eldermoor", "The Ashforge Family", "House Fenwick"]
        ),
        FestDinner(
            id: "d-thu",
            day: "Thursday",
            title: "The Cousins' Grand Potluck Banquet",
            chef: "Goodwife Maren of House Hollowbrook",
            menu: "A long table of dishes from every house (see the Crew board), with the Goodwife's grill lit at 5.",
            location: "Pavilion",
            time: "5:30 PM",
            crew: ["House Hollowbrook", "The Stagleigh Kin", "House Marrowin"]
        ),
        FestDinner(
            id: "d-fri",
            day: "Friday",
            title: "The Farewell Pig Roast",
            chef: "Sir Reginald of House Pemberlye",
            menu: "A smoked feast to send us off — slow brisket, herbed chicken, honeyed beans, and berry cobbler before the fireworks.",
            location: "Lakeside Pavilion",
            time: "6:00 PM",
            crew: ["House Pemberlye", "The Brightwater Family", "House Thornwood"]
        ),
    ]
}

// MARK: - T-Shirt Vote

struct TshirtVoteConfig {
    static let formUrl = "https://forms.gle/8aVV4b7vtkpKUm7N7"
    static let deadline = "2026-06-27"
    static let rankedChoice = true
    static let minVoterAge = 6
    static let designs: [TshirtDesign] = [
        TshirtDesign(
            id: "olde-fantasy",
            name: "Olde Fantasy",
            artist: "Rick G",
            imageName: "ff-shirt-olde-fantasy",
            blurb: "A hand-inked treasure map of Ye Olde Family Feste — sea serpent, castle, and a compass-rose crest, in heritage navy. Front pocket mark with the full map across the back."
        ),
        TshirtDesign(
            id: "swordstone",
            name: "SwordStone",
            artist: "Rick G",
            imageName: "ff-shirt-swordstone",
            blurb: "Woodcut-style sword in the stone, a hoarding dragon, and a knight riding out on the quest, under a smiling sun. Shown on maroon and forest green."
        ),
        TshirtDesign(
            id: "tomahawk-quest",
            name: "Tomahawk Quest",
            artist: "Abbie",
            imageName: "ff-shirt-tomahawk-quest",
            blurb: "An ornate dragon crest up front and a detailed Muskellunge Lake quest map — with a numbered key — across the back. Inky black line art."
        ),
        TshirtDesign(
            id: "toon-knight",
            name: "ToonKnight",
            artist: "Evan",
            imageName: "ff-shirt-toon-knight",
            blurb: "A friendly cartoon knight raising sword and banner in hand-lettered script — the playful, kid-favorite option. Comes in a red and a grey knight."
        ),
    ]
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
            id: "up-north-4th-2026",
            title: "Up North for the 4th",
            description: "The 4th of July weekend at the lake — fireworks, cookouts, and time on the water. Let everyone know if you're heading up.",
            kind: .holiday,
            startDate: "2026-07-03",
            endDate: "2026-07-05",
            location: "Muskellunge Lake Resort",
            dayRsvp: false,
            source: .seed
        ),
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
