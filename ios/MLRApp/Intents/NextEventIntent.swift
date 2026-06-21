import AppIntents

// MARK: - Next Event Intent
//
// "Hey Siri, what's next at MLR?" — reads the shared next-event snapshot the app
// keeps in the App Group store (no network, no auth needed since events are
// public-read). Returns a spoken + visual snippet.

struct NextEventIntent: AppIntent {
    static var title: LocalizedStringResource = "Next Event"
    static var description = IntentDescription("Tells you the next gathering at the resort.")
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
        guard let event = SharedStore.shared.nextEvent else {
            return .result(
                dialog: "There's nothing on the resort calendar right now.",
                view: IntentEventSnippet(title: "Nothing scheduled", dateLabel: "", emoji: "🌲")
            )
        }

        let dateLabel = MLRFormat.shortDateISO(event.startDate)
        let spoken = "The next event is \(event.title) on \(dateLabel)."
        return .result(
            dialog: IntentDialog(stringLiteral: spoken),
            view: IntentEventSnippet(title: event.title, dateLabel: dateLabel, emoji: event.emoji)
        )
    }
}

import SwiftUI

struct IntentEventSnippet: View {
    let title: String
    let dateLabel: String
    let emoji: String

    var body: some View {
        HStack(spacing: 12) {
            Text(emoji).font(.largeTitle)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                if !dateLabel.isEmpty {
                    Text(dateLabel).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding()
    }
}
