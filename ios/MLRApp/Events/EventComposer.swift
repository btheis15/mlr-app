import SwiftUI

// MARK: - EventComposer
// Admin create / edit form for resort events.
// Pass `existing` to edit; omit it to create a new event.

struct EventComposer: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    let existing: ResortEvent?

    @State private var title: String
    @State private var description: String
    @State private var kind: EventKind
    @State private var startDate: Date
    @State private var endDate: Date
    @State private var hasEndDate: Bool
    @State private var location: String
    @State private var dayRsvp: Bool

    @State private var isSaving = false
    @State private var saveError: String?

    init(existing: ResortEvent? = nil) {
        self.existing = existing
        let iso = DateFormatter()
        iso.dateFormat = "yyyy-MM-dd"
        iso.timeZone = TimeZone(identifier: "America/Chicago")

        _title       = State(initialValue: existing?.title ?? "")
        _description = State(initialValue: existing?.description ?? "")
        _kind        = State(initialValue: existing?.kind ?? .custom)
        _location    = State(initialValue: existing?.location ?? "")
        _dayRsvp     = State(initialValue: existing?.dayRsvp ?? false)

        let start = existing?.startDate.flatMap { iso.date(from: $0) } ?? .now
        _startDate = State(initialValue: start)

        if let endStr = existing?.endDate, let end = iso.date(from: endStr) {
            _endDate = State(initialValue: end)
            _hasEndDate = State(initialValue: true)
        } else {
            _endDate = State(initialValue: start)
            _hasEndDate = State(initialValue: false)
        }
    }

    private var isEditing: Bool { existing != nil }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Details") {
                    TextField("Event title", text: $title)
                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                    TextField("Location", text: $location)
                }

                Section("Kind") {
                    Picker("Kind", selection: $kind) {
                        Text("Work Weekend").tag(EventKind.workWeekend)
                        Text("Holiday").tag(EventKind.holiday)
                        Text("Other event").tag(EventKind.custom)
                    }
                    .pickerStyle(.segmented)
                    if isEditing && existing?.isFamilyFest == true {
                        Text("Family Fest kind is fixed.")
                            .font(.caption)
                            .foregroundStyle(Color.mlrTextMuted)
                    }
                }
                .disabled(existing?.isFamilyFest == true)

                Section("Dates") {
                    DatePicker("Starts", selection: $startDate, displayedComponents: .date)
                    Toggle("Multi-day event", isOn: $hasEndDate.animation())
                    if hasEndDate {
                        DatePicker("Ends", selection: $endDate,
                                   in: startDate..., displayedComponents: .date)
                    }
                }

                Section {
                    Toggle("Per-day RSVP", isOn: $dayRsvp)
                } footer: {
                    Text("Lets members pick which days they're coming (used for Family Fest).")
                }

                if let saveError {
                    Section {
                        Text(saveError)
                            .font(.mlrCaption)
                            .foregroundStyle(Color.mlrDanger)
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit Event" : "New Event")
            .navigationBarTitleDisplayMode(.inline)
            .tint(Color.mlrPrimary)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .fontWeight(.semibold)
                            .disabled(!canSave)
                    }
                }
            }
        }
    }

    private func save() async {
        isSaving = true
        saveError = nil
        defer { isSaving = false }

        let startISO = startDate.isoDateString
        let endISO: String? = hasEndDate ? endDate.isoDateString : nil
        let trimmedDesc = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let descParam = trimmedDesc.isEmpty ? nil : trimmedDesc
        let trimmedLoc = location.trimmingCharacters(in: .whitespacesAndNewlines)
        let locParam = trimmedLoc.isEmpty ? nil : trimmedLoc

        do {
            if let existing {
                try await env.eventsService.updateEvent(
                    id: existing.id,
                    title: title,
                    description: descParam,
                    startDate: startISO,
                    endDate: endISO,
                    location: locParam,
                    dayRsvp: dayRsvp
                )
            } else {
                try await env.eventsService.createEvent(
                    title: title,
                    description: descParam,
                    kind: kind,
                    startDate: startISO,
                    endDate: endISO,
                    location: locParam,
                    dayRsvp: dayRsvp
                )
            }
            dismiss()
        } catch {
            saveError = "Couldn't save the event. Check your connection and try again."
            print("[EventComposer] save error: \(error)")
        }
    }
}
