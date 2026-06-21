import SwiftUI

// MARK: - HomeView
// The main home screen. Mirrors the layout priority of app/page.tsx:
//   logo hero → announcement banner → fest spotlight → tshirt callout →
//   upcoming event → get involved → ask for help / people →
//   around the resort → heritage footer

struct HomeView: View {
    @Environment(AppEnvironment.self) private var env

    @State private var festSeason: FestSeason = .current()
    @State private var showAskSheet = false

    // Drive AttendanceControlStateless optimistically
    @State private var nearestEventStatus: AttendanceStatus? = nil

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {

                        // ── 1. MLR logo hero ──────────────────────────────
                        logoHero(geometry: geometry)

                        VStack(alignment: .leading, spacing: 20) {

                            // ── 2. Announcement banner ────────────────────
                            // AnnouncementBannerStack manages its own fetch + dismiss via env
                            AnnouncementBannerStack()

                            // ── 3. Family Fest spotlight ──────────────────
                            FamilyFestSpotlight(season: festSeason)

                            // ── 4. T-shirt callout (planning only) ────────
                            if festSeason.isPlanning {
                                TshirtCallout()
                            }

                            // ── 5. Upcoming event ─────────────────────────
                            if let event = env.eventsService.nearestEvent,
                               !festSeason.isTakeover || !event.isFamilyFest {
                                UpcomingEventCard(
                                    event: event,
                                    attendance: env.eventsService.attendances[event.id],
                                    currentStatusOverride: nearestEventStatus,
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
            festSeason = FestSeason.current()
            await env.eventsService.fetchEvents()
            if let userId = env.currentProfile?.id {
                await env.eventsService.fetchAttendance(userId: userId)
            }
        }
        .refreshable {
            festSeason = FestSeason.current()
            await env.eventsService.fetchEvents()
            if let userId = env.currentProfile?.id {
                await env.eventsService.fetchAttendance(userId: userId)
            }
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

    // "Ask for Help + People" row — beta gated card + people directory
    @ViewBuilder
    private var helpPeopleRow: some View {
        HStack(spacing: 12) {
            if env.isBetaTester && env.helpService.openRequests.count < 10 {
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

    // "Around the Resort" — Cabin Stay, Local Places, Activities
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

    // MARK: - Actions

    private func updateAttendance(event: ResortEvent, status: AttendanceStatus) async {
        // Optimistic UI update
        nearestEventStatus = status
        do {
            try await env.eventsService.upsertAttendance(eventId: event.id, status: status)
        } catch {
            // Roll back on failure
            nearestEventStatus = env.eventsService.attendances[event.id]?.effectiveStatus()
        }
    }

    private func toggleWillingToHelp() async {
        // WillingToHelp toggle is profile-level; reload profile after change.
        // The actual RPC call lives in ProfileView / a dedicated profile service.
        // For now, trigger a profile reload.
        await env.loadProfile()
    }
}

// MARK: - HomeTile
// A reusable card tile used on the Home grid.

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
