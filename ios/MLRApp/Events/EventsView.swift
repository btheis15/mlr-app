import SwiftUI

// MARK: - EventsView
// The resort calendar. Events grouped by month, an Upcoming/Past toggle,
// per-event RSVP via EventCard → EventSheet, admin "Create event".

struct EventsView: View {
    @Environment(AppEnvironment.self) private var env

    @State private var filter: TimeFilter = .upcoming
    @State private var selectedEvent: ResortEvent?
    @State private var showComposer = false
    @State private var hasLoaded = false

    enum TimeFilter: String, CaseIterable {
        case upcoming = "Upcoming"
        case past = "Past"
    }

    private var events: [ResortEvent] {
        env.eventsService.events
    }

    private var filteredEvents: [ResortEvent] {
        let today = Calendar.current.startOfDay(for: .now)
        switch filter {
        case .upcoming:
            return events
                .filter { ($0.endDateParsed ?? $0.startDateParsed ?? .distantPast) >= today }
                .sorted { ($0.startDateParsed ?? .distantFuture) < ($1.startDateParsed ?? .distantFuture) }
        case .past:
            return events
                .filter { ($0.endDateParsed ?? $0.startDateParsed ?? .distantFuture) < today }
                .sorted { ($0.startDateParsed ?? .distantPast) > ($1.startDateParsed ?? .distantPast) }
        }
    }

    // Group into [monthLabel: [events]] preserving order
    private var grouped: [(month: String, events: [ResortEvent])] {
        let fmt = DateFormatter()
        fmt.dateFormat = "MMMM yyyy"
        fmt.timeZone = TimeZone(identifier: "America/Chicago")

        var order: [String] = []
        var map: [String: [ResortEvent]] = [:]
        for event in filteredEvents {
            let key = event.startDateParsed.map { fmt.string(from: $0) } ?? "Scheduled"
            if map[key] == nil { order.append(key) }
            map[key, default: []].append(event)
        }
        return order.map { ($0, map[$0] ?? []) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if env.eventsService.isLoading && !hasLoaded {
                    ScrollView {
                        VStack(spacing: 16) {
                            ForEach(0..<4, id: \.self) { _ in SkeletonCard(height: 120) }
                        }
                        .padding(.vertical, 16)
                    }
                } else if filteredEvents.isEmpty {
                    emptyState
                } else {
                    eventList
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Events")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("Filter", selection: $filter) {
                        ForEach(TimeFilter.allCases, id: \.self) { f in
                            Text(f.rawValue).tag(f)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 200)
                }
                if env.isAdmin {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showComposer = true
                        } label: {
                            Image(systemName: "plus")
                        }
                        .tint(Color.mlrPrimary)
                    }
                }
            }
            .sheet(item: $selectedEvent) { event in
                EventSheet(event: event)
            }
            .sheet(isPresented: $showComposer) {
                EventComposer()
            }
            .task {
                guard !hasLoaded else { return }
                await env.eventsService.fetchEvents()
                if let userId = await env.authService.userId {
                    await env.eventsService.fetchAttendance(userId: userId)
                }
                hasLoaded = true
            }
        }
    }

    // MARK: - List

    private var eventList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24, pinnedViews: [.sectionHeaders]) {
                ForEach(grouped, id: \.month) { group in
                    Section {
                        VStack(spacing: 12) {
                            ForEach(group.events) { event in
                                EventCard(
                                    event: event,
                                    summary: env.eventsService.summaries[event.id],
                                    myStatus: env.eventsService.attendances[event.id]?.effectiveStatus()
                                ) {
                                    selectedEvent = event
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                    } header: {
                        Text(group.month)
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Color.mlrTextMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(Color(.systemGroupedBackground))
                    }
                }
            }
            .padding(.vertical, 12)
        }
        .refreshable {
            await env.eventsService.fetchEvents()
            if let userId = await env.authService.userId {
                await env.eventsService.fetchAttendance(userId: userId)
            }
        }
    }

    // MARK: - Empty

    private var emptyState: some View {
        ContentUnavailableView {
            Label(filter == .upcoming ? "Nothing on the calendar" : "No past events",
                  systemImage: "calendar")
        } description: {
            Text(filter == .upcoming
                 ? "When events get scheduled, they'll show up here."
                 : "Past events will appear here after they wrap.")
        } actions: {
            if env.isAdmin && filter == .upcoming {
                Button("Create Event") { showComposer = true }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.mlrPrimary)
            }
        }
    }
}
