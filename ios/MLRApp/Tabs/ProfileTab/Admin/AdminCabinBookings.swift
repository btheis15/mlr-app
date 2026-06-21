import SwiftUI

// MARK: - AdminCabinBookings
// Shows all cabin booking requests grouped by status (Pending first),
// with Approve/Deny actions for pending items and a realtime subscription.

struct AdminCabinBookings: View {
    @Environment(AppEnvironment.self) private var env

    @State private var bookings: [CabinBooking] = []
    @State private var cabins: [UUID: Cabin] = [:]
    @State private var isLoading = false
    @State private var error: String? = nil
    @State private var actionError: String? = nil

    // Group order: pending first
    private let statusOrder: [BookingStatus] = [.pending, .approved, .denied, .cancelled]

    private var grouped: [(status: BookingStatus, items: [CabinBooking])] {
        statusOrder.compactMap { status in
            let items = bookings.filter { $0.status == status }
            return items.isEmpty ? nil : (status: status, items: items)
        }
    }

    // MARK: - Body

    var body: some View {
        List {
            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(Color.mlrDanger)
                        .font(.subheadline)
                }
            }

            if let actionError {
                Section {
                    Label(actionError, systemImage: "xmark.circle")
                        .foregroundStyle(Color.mlrWarning)
                        .font(.subheadline)
                }
            }

            if isLoading && bookings.isEmpty {
                ForEach(0..<4, id: \.self) { _ in
                    bookingSkeleton
                }
            } else if !isLoading && bookings.isEmpty && error == nil {
                emptyState
            } else {
                ForEach(grouped, id: \.status.rawValue) { group in
                    Section {
                        ForEach(group.items) { booking in
                            BookingRow(
                                booking: booking,
                                cabin: cabins[booking.cabinId],
                                onApprove: { note in Task { await approveBooking(booking, note: note) } },
                                onDeny:    { note in Task { await denyBooking(booking, note: note) } }
                            )
                        }
                    } header: {
                        statusHeader(group.status)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Cabin Bookings")
        .navigationBarTitleDisplayMode(.large)
        .refreshable {
            await loadBookings()
        }
        .task {
            await loadCabins()
            await loadBookings()
            subscribeRealtime()
        }
    }

    // MARK: - Section header

    private func statusHeader(_ status: BookingStatus) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(statusColor(status))
                .frame(width: 7, height: 7)
            Text(status.label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(statusColor(status))
                .textCase(nil)
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        Section {
            VStack(spacing: 16) {
                Image(systemName: "house.lodge")
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(Color.mlrTextSubtle)
                Text("No booking requests")
                    .font(.headline)
                    .foregroundStyle(Color.mlrTextMuted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 48)
            .listRowBackground(Color.clear)
        }
    }

    // MARK: - Skeleton

    private var bookingSkeleton: some View {
        VStack(alignment: .leading, spacing: 8) {
            RoundedRectangle(cornerRadius: 4).fill(Color.mlrCard).frame(height: 14).frame(maxWidth: 160)
            RoundedRectangle(cornerRadius: 4).fill(Color.mlrCard).frame(height: 12).frame(maxWidth: 220)
            RoundedRectangle(cornerRadius: 4).fill(Color.mlrCard).frame(height: 12).frame(maxWidth: 140)
        }
        .padding(.vertical, 8)
    }

    // MARK: - Data

    @MainActor
    private func loadCabins() async {
        do {
            let result: [Cabin] = try await supabase
                .from("cabins")
                .select("*")
                .execute()
                .value
            cabins = Dictionary(uniqueKeysWithValues: result.map { ($0.id, $0) })
        } catch {
            // Non-fatal — booking rows will just omit cabin names
        }
    }

    @MainActor
    private func loadBookings() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let result: [CabinBooking] = try await supabase
                .from("cabin_bookings")
                .select("*")
                .order("created_at", ascending: false)
                .execute()
                .value
            bookings = result
        } catch {
            self.error = "Couldn't load booking requests."
        }
    }

    @MainActor
    private func approveBooking(_ booking: CabinBooking, note: String) async {
        actionError = nil
        do {
            try await supabase
                .rpc("admin_update_booking", params: [
                    "p_booking_id": booking.id.uuidString,
                    "p_status": BookingStatus.approved.rawValue,
                    "p_admin_note": note
                ])
                .execute()
            if let idx = bookings.firstIndex(where: { $0.id == booking.id }) {
                bookings[idx].status = .approved
                bookings[idx].adminNote = note.isEmpty ? nil : note
            }
        } catch {
            actionError = "Couldn't approve booking."
        }
    }

    @MainActor
    private func denyBooking(_ booking: CabinBooking, note: String) async {
        actionError = nil
        do {
            try await supabase
                .rpc("admin_update_booking", params: [
                    "p_booking_id": booking.id.uuidString,
                    "p_status": BookingStatus.denied.rawValue,
                    "p_admin_note": note
                ])
                .execute()
            if let idx = bookings.firstIndex(where: { $0.id == booking.id }) {
                bookings[idx].status = .denied
                bookings[idx].adminNote = note.isEmpty ? nil : note
            }
        } catch {
            actionError = "Couldn't deny booking."
        }
    }

    private func subscribeRealtime() {
        Task {
            let channel = await supabase.realtimeV2.channel("admin-cabin-bookings")
            let changes = await channel.postgresChange(
                AnyAction.self,
                schema: "public",
                table: "cabin_bookings"
            )
            await channel.subscribe()
            for await _ in changes {
                await loadBookings()
            }
        }
    }

    // MARK: - Helpers

    private func statusColor(_ status: BookingStatus) -> Color {
        switch status {
        case .pending:   return Color.mlrWarning
        case .approved:  return Color.mlrSuccess
        case .denied:    return Color.mlrDanger
        case .cancelled: return Color.mlrTextSubtle
        }
    }
}

// MARK: - BookingRow

private struct BookingRow: View {
    let booking: CabinBooking
    let cabin: Cabin?
    let onApprove: (String) -> Void
    let onDeny:    (String) -> Void

    @State private var adminNote: String = ""
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header row
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(booking.requesterName)
                        .font(.system(size: 15, weight: .semibold))
                    if let cabin {
                        Text(cabin.name)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.mlrTextMuted)
                    }
                    Text(dateRange)
                        .font(.caption)
                        .foregroundStyle(Color.mlrTextMuted)
                    Text("\(booking.guests) guest\(booking.guests == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(Color.mlrTextSubtle)
                }

                Spacer()

                Text(MLRFormat.relativeTime(booking.createdAt))
                    .font(.caption2)
                    .foregroundStyle(Color.mlrTextSubtle)
            }

            // Requester note
            if let note = booking.note, !note.isEmpty {
                Text(""\(note)"")
                    .font(.caption)
                    .foregroundStyle(Color.mlrTextMuted)
                    .italic()
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.mlrCard)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            // Admin note (existing)
            if let adminNote = booking.adminNote, !adminNote.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "person.fill.checkmark")
                        .font(.caption2)
                    Text("Admin: \(adminNote)")
                        .font(.caption)
                }
                .foregroundStyle(Color.mlrTextMuted)
            }

            // Pending: action UI
            if booking.status == .pending {
                if isExpanded {
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Admin note (optional)", text: $adminNote)
                            .font(.system(size: 13))
                            .padding(8)
                            .background(Color.mlrCard)
                            .clipShape(RoundedRectangle(cornerRadius: 6))

                        HStack(spacing: 10) {
                            Button {
                                onApprove(adminNote)
                                isExpanded = false
                            } label: {
                                Label("Approve", systemImage: "checkmark.circle.fill")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(maxWidth: .infinity, minHeight: 36)
                                    .background(Color.mlrSuccess)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            }

                            Button {
                                onDeny(adminNote)
                                isExpanded = false
                            } label: {
                                Label("Deny", systemImage: "xmark.circle.fill")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(maxWidth: .infinity, minHeight: 36)
                                    .background(Color.mlrDanger)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                        }

                        Button("Cancel") { isExpanded = false }
                            .font(.caption)
                            .foregroundStyle(Color.mlrTextMuted)
                    }
                } else {
                    Button {
                        isExpanded = true
                    } label: {
                        Text("Review request")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.mlrPrimary)
                            .frame(maxWidth: .infinity, minHeight: 32)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color.mlrPrimary.opacity(0.4), lineWidth: 1)
                            )
                    }
                }
            }
        }
        .padding(.vertical, 8)
        .onAppear { adminNote = booking.adminNote ?? "" }
    }

    private var dateRange: String {
        "\(MLRFormat.shortDateISO(booking.checkIn)) – \(MLRFormat.shortDateISO(booking.checkOut)) · \(booking.nightCount) night\(booking.nightCount == 1 ? "" : "s")"
    }
}

#Preview {
    NavigationStack {
        AdminCabinBookings()
    }
    .environment(AppEnvironment())
}
