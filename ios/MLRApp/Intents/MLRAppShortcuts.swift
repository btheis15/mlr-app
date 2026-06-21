import AppIntents

// MARK: - App Shortcuts (Siri)
//
// Registers the app's intents with Siri + Spotlight + the Shortcuts app, with
// spoken trigger phrases. "${applicationName}" expands to the app's name so users
// can say "What's next at MLR" etc. No setup needed by the user — these appear
// automatically once the app is installed.

struct MLRAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: NextEventIntent(),
            phrases: [
                "What's next at \(.applicationName)",
                "What's happening at the resort in \(.applicationName)",
                "Next event in \(.applicationName)"
            ],
            shortTitle: "Next Event",
            systemImageName: "calendar"
        )
        AppShortcut(
            intent: FestCountdownIntent(),
            phrases: [
                "How many days until Family Fest in \(.applicationName)",
                "Family Fest countdown in \(.applicationName)",
                "When is Family Fest in \(.applicationName)"
            ],
            shortTitle: "Fest Countdown",
            systemImageName: "tree"
        )
        AppShortcut(
            intent: AskForHelpIntent(),
            phrases: [
                "Ask for help in \(.applicationName)",
                "I need a hand in \(.applicationName)"
            ],
            shortTitle: "Ask for Help",
            systemImageName: "hand.raised"
        )
    }
}
