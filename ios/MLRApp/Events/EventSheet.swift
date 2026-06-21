import SwiftUI

// MARK: - EventSheet
// Full event detail: title, description, dates, location, the user's RSVP
// control (per-day for Family Fest), a "who's going" avatar stack, and
// admin Edit / Delete actions.

struct EventSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    let event: ResortEvent

    @State private var myStatus: AttendanceStatus?
    @State private var dayStatuses: [String: AttendanceStatus] = [:]
    @State private var isSaving = false
    @State private var attendees: [Profile] = []
    @State private var loadingAttendees = true
    @State private var showEditor = false
    @State private var showDeleteConfirm = false
    @State private var actionError: String?
    @State private var shareState: ShareState?
    @State private var calendarAdded = false
    @State private var calendarError: String?

    // Family Fest day labels (Mon–Sat across the fest window)
    private let festDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    private var accent: Color {
        EventKindStyle.color(for: event.kind)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header

                    if let desc = event.description, !desc.isEmpty {
                        Text(desc)
                            .font(.mlrBody)
                            .foregroundStyle(Color.mlrText)
                    }

                    detailRows

                    // WeatherKit forecast for the event date (self-hides if none)
                    EventWeatherBadge(isoDate: event.startDate, compact: false)

                    nativeActions

                    rsvpSection
                    whoIsGoingSection

                    if env.isAdmin {
                        adminActions
                    }

                    // Apple requires attribution on any screen showing WeatherKit data
                    WeatherAttributionView()
                        .padding(.top, 4)
                }
                .padding(20)
            }
            .background(Color.mlrSurface)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    CloseButton { dismiss() }
                }
            }
            .alert("Couldn't update", isPresented: .constant(actionError != nil)) {
                Button("OK") { actionError = nil }
            } message: {
                Text(actionError ?? "")
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.hidden)
        .sheet(isPresented: $showEditor) {
            EventComposer(existing: event)
        }
        .shareSheet($shareState)
        .confirmationDialog("Delete this event?",
                            isPresented: $showDeleteConfirm,
                            titleVisibility: .visible) {
            Button("Delete Event", role: .destructive) {
                Task { await deleteEvent() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the event and everyone's RSVPs. This can't be undone.")
        }
        .task { await load() }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            KindBadge(kind: event.kind)
            Text(event.title)
                .font(event.isFamilyFest
                      ? .festSerif(28, weight: .bold)
                      : .system(size: 26, weight: .bold))
                .foregroundStyle(event.isFamilyFest ? Color.mlrFest : Color.mlrText)
        }
    }

    // MARK: - Detail rows

    private var detailRows: some View {
        VStack(spacing: 12) {
            detailRow("calendar", MLRFormat.dateRange(start: event.startDate, end: event.endDate))
            if let location = event.location, !location.isEmpty {
                Protected {
                    detailRow("mappin.and.ellipse", location)
                }
            }
        }
    }

    private func detailRow(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(accent)
                .frame(width: 24)
            Text(text)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color.mlrText)
            Spacer()
        }
    }

    // MARK: - Native actions (Add to Calendar / Share / Directions)

    private var nativeActions: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    Task { await addToCalendar() }
                } label: {
                    Label(calendarAdded ? "Added ✓" : "Add to Calendar",
                          systemImage: calendarAdded ? "checkmark.circle.fill" : "calendar.badge.plus")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(calendarAdded ? Color.mlrSuccess : accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background((calendarAdded ? Color.mlrSuccess : accent).opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .disabled(calendarAdded)

                Button {
                    shareState = ShareState(items: shareItems)
                } label: {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(accent.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }

            if let location = event.location, !location.isEmpty {
                Button {
                    let lower = location.lowercased()
                    if lower.contains("resort") || lower.contains("muskellunge") {
                        MapsHelper.directionsToResort()
                    } else {
                        MapsHelper.directions(toAddress: location)
                    }
                } label: {
                    Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(accent.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }

            if let calendarError {
                Text(calendarError)
                    .font(.mlrCaption)
                    .foregroundStyle(Color.mlrDanger)
            }
        }
    }

    private var shareItems: [Any] {
        let dateLabel = MLRFormat.dateRange(start: event.startDate, end: event.endDate)
        var text = "\(event.title) · \(dateLabel)"
        if let link = URL(string: "mlr://events?id=\(event.id)") {
            return [text, link]
        }
        text += "\nmlr://events?id=\(event.id)"
        return [text]
    }

    private func addToCalendar() async {
        calendarError = nil
        do {
            _ = try await CalendarService.shared.addEvent(
                title: event.title,
                startISO: event.startDate,
                endISO: event.endDate,
                location: event.location,
                notes: event.description
            )
            Haptics.success()
            calendarAdded = true
        } catch {
            Haptics.error()
            calendarError = "Couldn't add to Calendar. Check Calendar access in Settings."
        }
    }

    // MARK: - RSVP

    private var rsvpSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: event.dayRsvp ? "Which days are you coming?" : "Are you going?")

            if event.dayRsvp {
                VStack(spacing: 8) {
                    ForEach(festDays, id: \.self) { day in
                        dayCheckbox(day)
                    }
                }
                .overlay {
                    if isSaving {
                        Color.mlrSurface.opacity(0.4)
                        ProgressView().tint(accent)
                    }
                }
            } else {
                AttendanceControl(
                    selection: $myStatus,
                    isEnabled: env.isSignedIn,
                    isLoading: isSaving,
                    onSelect: { status in
                        Task { await saveStatus(status) }
                    }
                )
            }

            if !env.isSignedIn {
                Text("Sign in to RSVP.")
                    .font(.mlrCaption)
                    .foregroundStyle(Color.mlrTextMuted)
            }
        }
        .padding(16)
        .cardStyle()
    }

    private func dayCheckbox(_ day: String) -> some View {
        Button {
            guard env.isSignedIn else {
                env.authService.promptSignIn(); return
            }
            let current = dayStatuses[day]
            dayStatuses[day] = current == .going ? .notGoing : .going
            Task { await saveDays() }
        } label: {
            HStack {
                Image(systemName: dayStatuses[day] == .going
                      ? "checkmark.square.fill" : "square")
                    .font(.system(size: 20))
                    .foregroundStyle(dayStatuses[day] == .going ? accent : Color.mlrTextSubtle)
                Text(day)
                    .font(.system(size: 15))
                    .foregroundStyle(Color.mlrText)
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isSaving)
    }

    // MARK: - Who's going

    private var whoIsGoingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Who's going")
            if loadingAttendees {
                SkeletonRow()
            } else if attendees.isEmpty {
                Text("No RSVPs yet — be the first!")
                    .font(.mlrCaption)
                    .foregroundStyle(Color.mlrTextMuted)
            } else {
                // Avatar stack
                HStack(spacing: -10) {
                    ForEach(attendees.prefix(8)) { person in
                        AvatarView(profile: person, size: .small)
                            .overlay(Circle().stroke(Color.mlrSurface, lineWidth: 2))
                    }
                    if attendees.count > 8 {
                        Text("+\(attendees.count - 8)")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color.mlrTextMuted)
                            .frame(width: 32, height: 32)
                            .background(Color.mlrCard)
                            .clipShape(Circle())
                            .overlay(Circle().stroke(Color.mlrSurface, lineWidth: 2))
                    }
                }
                // Names
                Text(attendees.map(\.name).joined(separator: ", "))
                    .font(.mlrCaption)
                    .foregroundStyle(Color.mlrTextMuted)
            }
        }
        .padding(16)
        .cardStyle()
    }

    // MARK: - Admin

    private var adminActions: some View {
        HStack(spacing: 12) {
            Button {
                showEditor = true
            } label: {
                Label("Edit", systemImage: "pencil")
                    .secondaryButton()
            }
            // Family Fest is synthesized and can't be deleted.
            if !event.isFamilyFest {
                Button(role: .destructive) {
                    showDeleteConfirm = true
                } label: {
                    Label("Delete", systemImage: "trash")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.mlrDanger)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.mlrDanger.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Data

    private func load() async {
        // Existing RSVP
        if let existing = env.eventsService.attendances[event.id] {
            myStatus = existing.status
            dayStatuses = existing.days ?? [:]
        }
        // Summary (refreshes count)
        _ = await env.eventsService.fetchSummary(eventId: event.id)
        // Attendees
        loadingAttendees = true
        do {
            attendees = try await env.eventsService.fetchWhoIsGoing(eventId: event.id)
        } catch {
            print("[EventSheet] whoIsGoing error: \(error)")
        }
        loadingAttendees = false
    }

    private func saveStatus(_ status: AttendanceStatus) async {
        guard env.isSignedIn else { env.authService.promptSignIn(); return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await env.eventsService.upsertAttendance(eventId: event.id, status: status)
            Haptics.success()
            await refreshAfterRSVP()
        } catch {
            actionError = "Couldn't save your RSVP. Try again."
        }
    }

    private func saveDays() async {
        isSaving = true
        defer { isSaving = false }
        let effective: AttendanceStatus = dayStatuses.values.contains(.going) ? .going : .notGoing
        myStatus = effective
        do {
            try await env.eventsService.upsertAttendance(
                eventId: event.id, status: effective, days: dayStatuses)
            Haptics.success()
            await refreshAfterRSVP()
        } catch {
            actionError = "Couldn't save your days. Try again."
        }
    }

    private func refreshAfterRSVP() async {
        _ = await env.eventsService.fetchSummary(eventId: event.id)
        attendees = (try? await env.eventsService.fetchWhoIsGoing(eventId: event.id)) ?? attendees
    }

    private func deleteEvent() async {
        do {
            try await env.eventsService.deleteEvent(id: event.id)
            dismiss()
        } catch {
            actionError = "Couldn't delete the event."
        }
    }
}
