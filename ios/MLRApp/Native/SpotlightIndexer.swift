import Foundation
import CoreSpotlight
import UniformTypeIdentifiers

// MARK: - Spotlight Indexer (CoreSpotlight)
//
// Indexes resort content so a family member searching their *phone* (swipe-down
// Spotlight) finds "Family Fest", a member's name, a committee, or an event — and
// tapping the result deep-links straight into the app. Re-indexed after each data
// refresh; cheap and entirely local.
//
// Deep links use the `mlr://` scheme handled in RootView. The Spotlight item's
// `uniqueIdentifier` is the deep-link URL string.

enum SpotlightIndexer {
    private static let domain = "com.muskellungelakeresort.mlr"

    static func index(events: [ResortEvent], members: [Profile], committees: [Committee]) {
        var items: [CSSearchableItem] = []

        for e in events {
            let attrs = CSSearchableItemAttributeSet(contentType: .text)
            attrs.title = e.title
            attrs.contentDescription = [MLRFormat.shortDateISO(e.startDate), e.location]
                .compactMap { $0 }.joined(separator: " · ")
            attrs.keywords = ["event", "resort", e.kind.rawValue]
            items.append(CSSearchableItem(uniqueIdentifier: "mlr://events?id=\(e.id)",
                                          domainIdentifier: "\(domain).events",
                                          attributeSet: attrs))
        }

        for m in members {
            let attrs = CSSearchableItemAttributeSet(contentType: .contact)
            attrs.title = m.name
            attrs.contentDescription = "MLR family member"
            attrs.keywords = ["member", "people", "family"]
            if let phone = m.phone { attrs.phoneNumbers = [phone] }
            if !m.email.isEmpty { attrs.emailAddresses = [m.email] }
            items.append(CSSearchableItem(uniqueIdentifier: "mlr://people?id=\(m.id.uuidString)",
                                          domainIdentifier: "\(domain).people",
                                          attributeSet: attrs))
        }

        for c in committees {
            let attrs = CSSearchableItemAttributeSet(contentType: .text)
            attrs.title = "\(c.emoji ?? "📋") \(c.name)"
            attrs.contentDescription = c.description
            attrs.keywords = ["committee", "volunteer"]
            items.append(CSSearchableItem(uniqueIdentifier: "mlr://committees?slug=\(c.slug)",
                                          domainIdentifier: "\(domain).committees",
                                          attributeSet: attrs))
        }

        CSSearchableIndex.default().indexSearchableItems(items) { error in
            if let error { print("[Spotlight] index error: \(error)") }
        }
    }

    static func clearAll() {
        CSSearchableIndex.default().deleteAllSearchableItems { _ in }
    }
}
