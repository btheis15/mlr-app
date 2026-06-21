import Foundation
import Supabase

// MARK: - CabinService

@Observable
@MainActor
final class CabinService {
    var cabins: [Cabin] = []
    var myBookings: [CabinBooking] = []
    var allBookings: [CabinBooking] = []   // admin only
    var isLoading: Bool = false
    var error: String? = nil

    // MARK: - Cabins

    func fetchCabins() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let rows: [Cabin] = try await supabase
                .from("cabins")
                .select("*")
                .order("sort_order", ascending: true)
                .execute()
                .value
            cabins = rows
        } catch {
            self.error = "Couldn't load cabins."
            print("[CabinService] fetchCabins error: \(error)")
        }
    }

    // MARK: - Bookings

    func requestStay(
        cabinId: UUID,
        checkIn: String,
        checkOut: String,
        guests: Int,
        note: String?
    ) async throws {
        struct StayParams: Encodable {
            let p_cabin_id: String
            let p_check_in: String
            let p_check_out: String
            let p_guests: Int
            let p_note: String?
        }
        try await supabase
            .rpc("request_cabin_stay", params: StayParams(
                p_cabin_id: cabinId.uuidString,
                p_check_in: checkIn,
                p_check_out: checkOut,
                p_guests: guests,
                p_note: note
            ))
            .execute()
    }

    func fetchMyBookings(userId: UUID) async {
        do {
            let rows: [CabinBooking] = try await supabase
                .from("cabin_bookings")
                .select("""
                    *,
                    cabins!cabin_id(id, slug, name, description, room_count, max_guests, image_url, sort_order)
                """)
                .eq("user_id", value: userId.uuidString)
                .order("check_in", ascending: true)
                .execute()
                .value
            myBookings = rows
        } catch {
            print("[CabinService] fetchMyBookings error: \(error)")
        }
    }

    /// Admin only — uses the admin_cabin_bookings RPC to see all bookings.
    func fetchAllBookings() async {
        do {
            let rows: [CabinBooking] = try await supabase
                .rpc("admin_cabin_bookings")
                .execute()
                .value
            allBookings = rows
        } catch {
            print("[CabinService] fetchAllBookings error: \(error)")
        }
    }

    func approveBooking(bookingId: UUID, adminNote: String?) async throws {
        try await setBookingStatus(
            bookingId: bookingId,
            status: .approved,
            adminNote: adminNote
        )
    }

    func denyBooking(bookingId: UUID, adminNote: String?) async throws {
        try await setBookingStatus(
            bookingId: bookingId,
            status: .denied,
            adminNote: adminNote
        )
    }

    func cancelBooking(bookingId: UUID) async throws {
        try await setBookingStatus(
            bookingId: bookingId,
            status: .cancelled,
            adminNote: nil
        )
        // Remove from local lists optimistically
        myBookings.removeAll { $0.id == bookingId }
    }

    // MARK: - Private

    private func setBookingStatus(
        bookingId: UUID,
        status: BookingStatus,
        adminNote: String?
    ) async throws {
        struct StatusParams: Encodable {
            let p_booking_id: String
            let p_status: String
            let p_admin_note: String?
        }
        try await supabase
            .rpc("set_cabin_booking_status", params: StatusParams(
                p_booking_id: bookingId.uuidString,
                p_status: status.rawValue,
                p_admin_note: adminNote
            ))
            .execute()

        // Optimistic update in both lists
        updateBookingStatus(id: bookingId, status: status, adminNote: adminNote, in: &myBookings)
        updateBookingStatus(id: bookingId, status: status, adminNote: adminNote, in: &allBookings)
    }

    private func updateBookingStatus(
        id: UUID,
        status: BookingStatus,
        adminNote: String?,
        in list: inout [CabinBooking]
    ) {
        guard let idx = list.firstIndex(where: { $0.id == id }) else { return }
        list[idx].status = status
        if let note = adminNote { list[idx].adminNote = note }
    }
}
