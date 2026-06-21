import SwiftUI

// MARK: - CabinRequestSheet
// Request a cabin stay: pick a cabin, choose check-in/check-out dates,
// set guest count, add a note, submit. Shows a confirmation on success.

struct CabinRequestSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    /// Optional pre-selected cabin.
    var preselected: Cabin?

    @State private var selectedCabin: Cabin?
    @State private var checkIn: Date = .now
    @State private var checkOut: Date = Calendar.current.date(byAdding: .day, value: 2, to: .now) ?? .now
    @State private var guests = 2
    @State private var note = ""
    @State private var isSubmitting = false
    @State private var submitError: String?
    @State private var didSubmit = false
    @State private var loadingCabins = true

    private var cabins: [Cabin] { env.cabinService.cabins }

    private var nightCount: Int {
        max(0, Calendar.current.dateComponents([.day], from: checkIn, to: checkOut).day ?? 0)
    }

    private var canSubmit: Bool {
        selectedCabin != nil && nightCount > 0 && !isSubmitting
    }

    var body: some View {
        NavigationStack {
            Group {
                if didSubmit {
                    confirmation
                } else {
                    form
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(didSubmit ? "Request sent" : "Request a Cabin")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(didSubmit ? "Done" : "Cancel") { dismiss() }
                }
                if !didSubmit {
                    ToolbarItem(placement: .confirmationAction) {
                        if isSubmitting {
                            ProgressView()
                        } else {
                            Button("Submit") { Task { await submit() } }
                                .fontWeight(.semibold)
                                .disabled(!canSubmit)
                        }
                    }
                }
            }
            .task { await loadCabins() }
        }
    }

    // MARK: - Form

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Cabin picker
                VStack(alignment: .leading, spacing: 10) {
                    SectionLabel(text: "Choose a cabin")
                    if loadingCabins {
                        SkeletonShape(height: 120, cornerRadius: 16)
                    } else if cabins.isEmpty {
                        Text("No cabins available right now.")
                            .font(.mlrCaption)
                            .foregroundStyle(Color.mlrTextMuted)
                    } else {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(cabins) { cabin in
                                    CabinPickCard(
                                        cabin: cabin,
                                        isSelected: selectedCabin?.id == cabin.id
                                    ) { selectedCabin = cabin }
                                }
                            }
                            .padding(.horizontal, 2)
                        }
                    }
                }

                // Dates
                VStack(alignment: .leading, spacing: 12) {
                    SectionLabel(text: "Dates")
                    DatePicker("Check-in", selection: $checkIn, displayedComponents: .date)
                        .onChange(of: checkIn) { _, new in
                            if checkOut <= new {
                                checkOut = Calendar.current.date(byAdding: .day, value: 1, to: new) ?? new
                            }
                        }
                    DatePicker("Check-out", selection: $checkOut,
                               in: checkIn..., displayedComponents: .date)
                    if nightCount > 0 {
                        Text("\(nightCount) night\(nightCount == 1 ? "" : "s")")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Color.mlrPrimary)
                    }
                }
                .padding(16)
                .cardStyle()

                // Guests
                VStack(alignment: .leading, spacing: 12) {
                    SectionLabel(text: "Guests")
                    Stepper(value: $guests, in: 1...maxGuests) {
                        Text("\(guests) guest\(guests == 1 ? "" : "s")")
                            .foregroundStyle(Color.mlrText)
                    }
                    if let cabin = selectedCabin {
                        Text("Sleeps up to \(cabin.maxGuests).")
                            .font(.mlrCaption)
                            .foregroundStyle(Color.mlrTextMuted)
                    }
                }
                .padding(16)
                .cardStyle()

                // Note
                VStack(alignment: .leading, spacing: 10) {
                    SectionLabel(text: "Note for the resort (optional)")
                    TextField("Anything we should know?", text: $note, axis: .vertical)
                        .lineLimit(2...4)
                        .fieldStyle()
                }

                if let submitError {
                    Text(submitError)
                        .font(.mlrCaption)
                        .foregroundStyle(Color.mlrDanger)
                }
            }
            .padding(20)
        }
    }

    private var maxGuests: Int {
        selectedCabin?.maxGuests ?? 12
    }

    // MARK: - Confirmation

    private var confirmation: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(Color.mlrSuccess)
            Text("Request sent!")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Color.mlrText)
            Text("An admin will review your stay and you'll get a notification when it's approved.")
                .font(.mlrBody)
                .foregroundStyle(Color.mlrTextMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Spacer()
            Button("Done") { dismiss() }
                .primaryButton()
                .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Data

    private func loadCabins() async {
        loadingCabins = cabins.isEmpty
        if cabins.isEmpty {
            await env.cabinService.fetchCabins()
        }
        if selectedCabin == nil {
            selectedCabin = preselected ?? cabins.first
        }
        loadingCabins = false
    }

    private func submit() async {
        guard env.isSignedIn else { env.authService.promptSignIn(); return }
        guard let cabin = selectedCabin else { return }
        isSubmitting = true
        submitError = nil
        defer { isSubmitting = false }

        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await env.cabinService.requestStay(
                cabinId: cabin.id,
                checkIn: checkIn.isoDateString,
                checkOut: checkOut.isoDateString,
                guests: guests,
                note: trimmedNote.isEmpty ? nil : trimmedNote
            )
            if let userId = await env.authService.userId {
                await env.cabinService.fetchMyBookings(userId: userId)
            }
            withAnimation { didSubmit = true }
        } catch {
            submitError = "Couldn't submit your request. Check your connection and try again."
            print("[CabinRequest] submit error: \(error)")
        }
    }
}

// MARK: - Cabin Pick Card

private struct CabinPickCard: View {
    let cabin: Cabin
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 0) {
                ZStack {
                    if let urlString = cabin.imageUrl, let url = URL(string: urlString) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image.resizable().scaledToFill()
                            default:
                                placeholderImage
                            }
                        }
                    } else {
                        placeholderImage
                    }
                }
                .frame(width: 180, height: 110)
                .clipped()

                VStack(alignment: .leading, spacing: 3) {
                    Text(cabin.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.mlrText)
                    Text("\(cabin.roomCount) rooms · sleeps \(cabin.maxGuests)")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.mlrTextMuted)
                }
                .frame(width: 180, alignment: .leading)
                .padding(10)
            }
            .background(Color.mlrCard)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(isSelected ? Color.mlrPrimary : Color.clear, lineWidth: 2.5)
            )
        }
        .buttonStyle(.plain)
    }

    private var placeholderImage: some View {
        Color.mlrPrimaryLight
            .overlay(
                Image(systemName: "house.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(Color.mlrPrimary)
            )
    }
}
