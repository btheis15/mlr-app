import SwiftUI

// MARK: - HomeNavigationStubs
// Placeholder destination views referenced by HomeView that don't yet have a
// real implementation. EventsView, EventSheet, ActivitiesView, and
// HelpRequestsView now have real implementations elsewhere and were removed
// from here. Replace each remaining stub with the real screen as it's built.

// MARK: - CabinStayView stub

struct CabinStayView: View {
    var body: some View {
        ContentUnavailableView(
            "Cabin Stay",
            systemImage: "house.lodge.fill",
            description: Text("Cabin request & management coming soon.")
        )
        .navigationTitle("Cabin Stay")
    }
}

// MARK: - LocalPlacesView stub

struct LocalPlacesView: View {
    var body: some View {
        ContentUnavailableView(
            "Local Places",
            systemImage: "mappin.and.ellipse",
            description: Text("Nearby restaurants & businesses coming soon.")
        )
        .navigationTitle("Local Places")
    }
}
