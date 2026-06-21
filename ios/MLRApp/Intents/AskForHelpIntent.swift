import AppIntents

// MARK: - Ask for Help Intent
//
// "Hey Siri, ask for help in MLR" — opens the app to the Ask-for-Help sheet.
// Posting a help request requires sign-in + presence checks, so this intent just
// deep-links into the flow rather than posting headlessly. Opening the app lets
// the existing beta gate + sign-in wall apply.

struct AskForHelpIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask for Help"
    static var description = IntentDescription("Opens MLR to post a request for a hand at the resort.")
    static var openAppWhenRun = true

    @Dependency private var router: IntentRouter

    func perform() async throws -> some IntentResult {
        await router.requestRoute(.askForHelp)
        return .result()
    }
}

// MARK: - Intent Router
//
// Bridges intents that open the app to in-app navigation. Register as an
// App Intent dependency in the app's init:
//   AppDependencyManager.shared.add(dependency: IntentRouter.shared)
// and observe `pendingRoute` from RootView.

import SwiftUI

@MainActor
@Observable
final class IntentRouter {
    static let shared = IntentRouter()

    enum Route: Equatable {
        case askForHelp
        case familyFest
        case events
    }

    var pendingRoute: Route?

    func requestRoute(_ route: Route) {
        pendingRoute = route
    }

    func consume() -> Route? {
        defer { pendingRoute = nil }
        return pendingRoute
    }
}
