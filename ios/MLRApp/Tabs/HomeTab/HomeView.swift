import SwiftUI

// MARK: - HomeView
// The main home screen. Mirrors the layout priority of app/page.tsx:
//   logo hero → announcement banner → fest spotlight → tshirt callout →
//   upcoming event → get involved → ask for help / people →
//   around the resort → heritage footer

struct HomeView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.navigate) private var navigate

    @State private var festSeason: FestSeason = .current()
    @State private var announcements: [Announcement] = []
    @State private var upcomingEvent: ResortEvent? = nil
    @State private var myAttendance: EventAttendance? = nil
    @State private var openRequestCount: Int = 0
    @State private var showAskSheet = false

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {

                        // ── 1. MLR logo hero ──────────────────────────────
                        logoHero(geometry: geometry)

                        VStack(alignment: .leading, spacing: 20) {

                            // ── 2. Announcement banner ────────────────────
                            AnnouncementBanner(
                                announcements: announcements,
                                dismissedIds: env.dismissedAnnouncementIds,
                                onDismiss: { id in
                                    env.dismissedAnnouncementIds.insert(id)
                                }
                            )

                            // ── 3. Family Fest spotlight ──────────────────
                            FamilyFestSpotlight(season: festSeason)

                            // ── 4. T-shirt callout (planning only) ────────
                            if festSeason.isPlanning {
                                TshirtCallout()
                            }

                            // ── 5. Upcoming event ─────────────────────────
                            if let event = upcomingEvent {
                                UpcomingEventCard(
                                    event: event,
                                    attendance: myAttendance,
                                    onAttendanceChange: { status in
                                        await updateAttendance(event: event, status: status)
                                    }
                                )
                            }

                            // ── 6. Get Involved ───────────────────────────
                            getInvolvedSection

                            // ── 7. Ask for Help + People ──────────────────
                            helpPeopleRow

                            // ── 8. Around the Resort ─────────────────────
                            aroundResortSection

                            // ── 9. Heritage footer ────────────────────────
                            heritageFooter
                                .padding(.bottom, 32)
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                    }
                }
            }
            .navigationBarHidden(true)
            .background(Color.mlrSurface)
        }
        .sheet(isPresented: $showAskSheet) {
            AskForHelpSheet()
        }
        .task {
            await loadData()
        }
        .refreshable {
            await loadData()
        }
    }

    // MARK: - Subviews

    @ViewBuilder
    private func logoHero(geometry: GeometryProxy) -> some View {
        let logoWidth = min(geometry.size.width * 0.55, 220.0)
        HStack {
            Spacer()
            Image("brand-logo-green")
                .resizable()
                .scaledToFit()
                .frame(maxWidth: logoWidth)
                .padding(.vertical, 24)
            Spacer()
        }
    }

    // "Get Involved" — two tiles: Events, Work Weekends
    private var getInvolvedSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Get Involved")
            HStack(spacing: 12) {
                NavigationLink(destination: EventsView()) {
                    HomeTile(
                        icon: "calendar",
                        title: "Events",
                        subtitle: "Resort calendar + RSVP",
                        tint: Color.mlrPrimary
                    )
                }
                NavigationLink(destination: EventsView(filter: .workWeekend)) {
                    HomeTile(
                        icon: "hammer.fill",
                        title: "Work Weekends",
                        subtitle: "Volunteer & help out",
                        tint: Color.mlrAccent
                    )
                }
            }
        }
    }

    // "Ask for Help + People" row
    @ViewBuilder
    private var helpPeopleRow: some View {
        HStack(spacing: 12) {
            // Beta-gated Ask for Help card
            if env.isBetaTester && openRequestCount < 10 {
                AskForHelpHomeCard(
                    willingToHelp: env.currentProfile?.willingToHelp ?? false,
                    onAsk: { showAskSheet = true },
                    onToggleWilling: {
                        await toggleWillingToHelp()
                    }
                )
                .frame(maxWidth: .infinity)
            }

            NavigationLink(destination: PeopleDirectoryView()) {
                HomeTile(
                    icon: "person.2.fill",
                    title: "People",
                    subtitle: "Member directory",
                    tint: Color.mlrInfo
                )
            }
            .frame(maxWidth: .infinity)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    // "Around the Resort" tiles
    private var aroundResortSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Around the Resort")
            HStack(spacing: 12) {
                NavigationLink(destination: CabinStayView()) {
                    HomeTile(
                        icon: "house.lodge.fill",
                        title: "Cabin Stay",
                        subtitle: "Request & manage stays",
                        tint: Color.mlrPrimary
                    )
                }
                NavigationLink(destination: LocalPlacesView()) {
                    HomeTile(
                        icon: "mappin.and.ellipse",
                        title: "Local Places",
                        subtitle: "Nearby restaurants & more",
                        tint: Color.mlrAccent
                    )
                }
            }
            NavigationLink(destination: ActivitiesView()) {
                HomeTile(
                    icon: "figure.fishing",
                    title: "Activities",
                    subtitle: "Fishing · Boating · Hiking & more",
                    tint: Color.mlrPrimary,
                    fullWidth: true
                )
            }
        }
    }

    private var heritageFooter: some View {
        HStack {
            Spacer()
            Text("Est. 1987 · Leo & Dorothy Theis · Tomahawk, WI")
                .font(.caption2)
                .foregroundStyle(Color.mlrTextSubtle)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .padding(.top, 8)
    }

    // MARK: - Data loading

    private func loadData() async {
        festSeason = FestSeason.current()

        // Announcements
        announcements = (try? await env.eventsService.fetchAnnouncements()) ?? Announcement.seed

        // Nearest non-Family-Fest event
        let events = await env.eventsService.fetchMergedEvents()
        upcomingEvent = events
            .filter { !$0.isFamilyFest }
            .filter { ($0.startDateParsed ?? .distantPast) >= Calendar.current.startOfDay(for: .now) }
            .sorted { ($0.startDateParsed ?? .distantFuture) < ($1.startDateParsed ?? .distantFuture) }
            .first

        if let event = upcomingEvent, let userId = env.currentProfile?.id {
            myAttendance = try? await env.eventsService.fetchMyAttendance(
                eventId: event.id,
                userId: userId
            )
        }

        // Open help request count (for beta card cap)
        if env.isBetaTester {
            openRequestCount = (try? await env.helpService.fetchOpenRequestCount()) ?? 0
        }
    }

    private func updateAttendance(event: ResortEvent, status: AttendanceStatus) async {
        guard let userId = env.currentProfile?.id else { return }
        myAttendance = try? await env.eventsService.upsertAttendance(
            eventId: event.id,
            userId: userId,
            status: status
        )
    }

    private func toggleWillingToHelp() async {
        guard let profile = env.currentProfile else { return }
        try? await env.helpService.setWillingToHelp(
            userId: profile.id,
            willing: !profile.willingToHelp
        )
        await env.loadProfile()
    }
}

// MARK: - HomeTile
// A reusable two-column tile card used on the Home grid.

struct HomeTile: View {
    let icon: String
    let title: String
    let subtitle: String
    let tint: Color
    var fullWidth: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(tint)

            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.mlrText)

            Text(subtitle)
                .font(.caption)
                .foregroundStyle(Color.mlrTextMuted)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: fullWidth ? .infinity : nil, alignment: .leading)
        .cardStyle()
    }
}

// MARK: - Navigate environment key
// Tabs can inject a closure to drive tab selection from deep within the hierarchy.

struct NavigateKey: EnvironmentKey {
    static let defaultValue: (Tab) -> Void = { _ in }
}

extension EnvironmentValues {
    var navigate: (Tab) -> Void {
        get { self[NavigateKey.self] }
        set { self[NavigateKey.self] = newValue }
    }
}
