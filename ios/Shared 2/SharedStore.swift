import Foundation

// MARK: - Shared Store (App Group)
//
// SHARED FILE — add to BOTH the app target and the MLRWidget extension target.
//
// A tiny snapshot the app writes and the widgets/intents read, via the App Group
// suite so it crosses the process boundary. Configure the App Group capability on
// both targets with the same id: "group.com.muskellungelakeresort.mlr".

struct EventSnapshot: Codable {
    let title: String
    let startDate: String   // ISO yyyy-MM-dd
    let emoji: String
    let location: String?
}

final class SharedStore {
    static let shared = SharedStore()

    static let appGroupId = "group.com.muskellungelakeresort.mlr"

    private let defaults: UserDefaults

    private init() {
        defaults = UserDefaults(suiteName: SharedStore.appGroupId) ?? .standard
    }

    private enum Key {
        static let nextEvent = "shared.nextEvent"
        static let memberName = "shared.memberName"
    }

    // MARK: Next event (for NextEventWidget + Siri intents)

    var nextEvent: EventSnapshot? {
        get {
            guard let data = defaults.data(forKey: Key.nextEvent) else { return nil }
            return try? JSONDecoder().decode(EventSnapshot.self, from: data)
        }
        set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: Key.nextEvent)
            } else {
                defaults.removeObject(forKey: Key.nextEvent)
            }
        }
    }

    // MARK: Member first name (for personalized Siri responses)

    var memberFirstName: String? {
        get { defaults.string(forKey: Key.memberName) }
        set { defaults.set(newValue, forKey: Key.memberName) }
    }

    /// Trigger a widget timeline reload after writing. Call from the app.
    func reloadWidgets() {
        #if canImport(WidgetKit)
        WidgetCenterReloader.reloadAll()
        #endif
    }
}

#if canImport(WidgetKit)
import WidgetKit
enum WidgetCenterReloader {
    static func reloadAll() {
        WidgetCenter.shared.reloadAllTimelines()
    }
}
#endif
