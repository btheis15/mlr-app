import SwiftUI

// MARK: - HomeNavigationStubs
// Placeholder destination views referenced by HomeView.
// Replace each with the real implementation as those screens are built out.
// These stubs satisfy the compiler; they render a coming-soon message at runtime.

// MARK: - EventsView stub

struct EventsView: View {
    /// Optional filter limiting which event kinds are shown.
    var filter: EventKind? = nil

    var body: some View {
        ContentUnavailableView(
            "Events",
            systemImage: "calendar",
            description: Text("Resort calendar coming soon.")
        )
        .navigationTitle(filter == .workWeekend ? "Work Weekends" : "Events")
    }
}

// MARK: - EventSheet stub
// Presented as a sheet from UpcomingEventCard; shows who's coming + day RSVP.

struct EventSheet: View {
    let event: ResortEvent
    let attendance: EventAttendance?

    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                event.title,
                systemImage: "calendar.badge.checkmark",
                description: Text("Attendance details coming soon.")
            )
            .navigationTitle(event.title)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

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

// MARK: - ActivitiesView stub

struct ActivitiesView: View {
    var body: some View {
        ContentUnavailableView(
            "Activities",
            systemImage: "figure.fishing",
            description: Text("Resort activities coming soon.")
        )
        .navigationTitle("Activities")
    }
}

// MARK: - HelpRequestsView stub
// Full help-request log at /help-requests.

struct HelpRequestsView: View {
    var body: some View {
        ContentUnavailableView(
            "Help Requests",
            systemImage: "hand.raised.fill",
            description: Text("Open help requests coming soon.")
        )
        .navigationTitle("Help Requests")
    }
}
