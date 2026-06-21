import SwiftUI
import CoreLocation

// MARK: - AskForHelpSheet (BETA)
// Compose an Ask-for-Help request: category, what (140 max), how many people,
// where + optional GPS pin, optional scheduled time, "notify everyone willing"
// escape hatch. Submits via helpService.requestHelp (event targeting is
// resolved inside the service via helpTargeting()).

struct AskForHelpSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    @State private var category: HelpCategory = .moving
    @State private var what = ""
    @State private var neededCount = 1
    @State private var whereText = ""
    @State private var hasSchedule = false
    @State private var scheduledFor: Date = .now
    @State private var notifyAll = false

    @State private var pinnedCoordinate: CLLocationCoordinate2D?
    @State private var isSubmitting = false
    @State private var submitError: String?

    @State private var locationManager = LocationPinManager()

    private let maxWhat = 140

    private var canSubmit: Bool {
        !what.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSubmitting
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    categorySection
                    whatSection
                    peopleSection
                    whereSection
                    scheduleSection
                    notifyAllSection

                    if let submitError {
                        Text(submitError)
                            .font(.mlrCaption)
                            .foregroundStyle(Color.mlrDanger)
                    }
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Ask for Help")
            .navigationBarTitleDisplayMode(.inline)
            .tint(Color.mlrFest)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Send") { Task { await submit() } }
                            .fontWeight(.semibold)
                            .disabled(!canSubmit)
                    }
                }
            }
            .onChange(of: locationManager.coordinate) { _, coord in
                if let coord { pinnedCoordinate = coord }
            }
        }
    }

    // MARK: - Category

    private var categorySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "What kind of help?")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(HelpCategory.allCases, id: \.self) { cat in
                        Button {
                            Haptics.tap()
                            category = cat
                        } label: {
                            Text("\(cat.emoji) \(cat.label)")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(category == cat ? .white : Color.mlrText)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(category == cat
                                            ? (cat == .urgent ? Color.mlrDanger : Color.mlrFest)
                                            : Color.mlrCard)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - What

    private var whatSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionLabel(text: "What do you need?")
                Spacer()
                Text("\(what.count)/\(maxWhat)")
                    .font(.system(size: 11))
                    .foregroundStyle(what.count > maxWhat ? Color.mlrDanger : Color.mlrTextSubtle)
            }
            TextEditor(text: $what)
                .frame(minHeight: 80)
                .padding(8)
                .background(Color.mlrSurface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.mlrBorder, lineWidth: 1))
                .onChange(of: what) { _, new in
                    if new.count > maxWhat { what = String(new.prefix(maxWhat)) }
                }
        }
    }

    // MARK: - People

    private var peopleSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "How many people?")
            Stepper(value: $neededCount, in: 1...5) {
                Text("\(neededCount) \(neededCount == 1 ? "person" : "people")")
                    .foregroundStyle(Color.mlrText)
            }
            .padding(14)
            .background(Color.mlrCard)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: - Where

    private var whereSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Where? (optional)")
            TextField("e.g. Cabin 3, the dock, the pavilion", text: $whereText)
                .fieldStyle()

            Button {
                locationManager.requestPin()
            } label: {
                HStack {
                    Image(systemName: pinnedCoordinate != nil ? "mappin.circle.fill" : "location.fill")
                    Text(pinnedCoordinate != nil ? "Location pinned" : "Pin my location")
                    Spacer()
                    if locationManager.isLocating {
                        ProgressView()
                    }
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(pinnedCoordinate != nil ? Color.mlrSuccess : Color.mlrFest)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .frame(maxWidth: .infinity)
                .background((pinnedCoordinate != nil ? Color.mlrSuccess : Color.mlrFest).opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)

            if let error = locationManager.errorMessage {
                Text(error)
                    .font(.mlrCaption)
                    .foregroundStyle(Color.mlrTextMuted)
            }
        }
    }

    // MARK: - Schedule

    private var scheduleSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $hasSchedule.animation()) {
                Text("Schedule for a specific time")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.mlrText)
            }
            .tint(Color.mlrFest)
            if hasSchedule {
                DatePicker("When", selection: $scheduledFor, displayedComponents: [.date, .hourAndMinute])
            }
        }
        .padding(14)
        .background(Color.mlrCard)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Notify all

    private var notifyAllSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: $notifyAll) {
                Text("Notify everyone willing")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.mlrText)
            }
            .tint(Color.mlrFest)
            Text("Reaches all willing helpers, even those not currently at the resort. Use when you really need the extra hands.")
                .font(.mlrCaption)
                .foregroundStyle(Color.mlrTextMuted)
        }
        .padding(14)
        .background(Color.mlrCard)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Submit

    private func submit() async {
        guard env.isSignedIn else { env.authService.promptSignIn(); return }
        isSubmitting = true
        submitError = nil
        defer { isSubmitting = false }

        let trimmedWhere = whereText.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await env.helpService.requestHelp(
                category: category,
                what: what.trimmingCharacters(in: .whitespacesAndNewlines),
                neededCount: neededCount,
                whereDescription: trimmedWhere.isEmpty ? nil : trimmedWhere,
                latitude: pinnedCoordinate?.latitude,
                longitude: pinnedCoordinate?.longitude,
                scheduledFor: hasSchedule ? scheduledFor : nil,
                notifyAll: notifyAll
            )
            Haptics.success()
            dismiss()
        } catch {
            submitError = "Couldn't send your request. Check your connection and try again."
            print("[AskForHelp] submit error: \(error)")
        }
    }
}

// MARK: - Location Pin Manager

@Observable
final class LocationPinManager: NSObject, CLLocationManagerDelegate {
    var coordinate: CLLocationCoordinate2D?
    var isLocating = false
    var errorMessage: String?

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func requestPin() {
        errorMessage = nil
        isLocating = true
        let status = manager.authorizationStatus
        switch status {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .denied, .restricted:
            isLocating = false
            errorMessage = "Location access is off. Enable it in Settings to drop a pin."
        @unknown default:
            isLocating = false
        }
    }

    // MARK: - Delegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            if isLocating { manager.requestLocation() }
        case .denied, .restricted:
            isLocating = false
            errorMessage = "Location access is off. Enable it in Settings to drop a pin."
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        isLocating = false
        if let loc = locations.last {
            coordinate = loc.coordinate
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        isLocating = false
        errorMessage = "Couldn't get your location. Try again or type where you are."
    }
}

// MARK: - Coordinate equatable conformance for onChange

extension CLLocationCoordinate2D: @retroactive Equatable {
    public static func == (lhs: CLLocationCoordinate2D, rhs: CLLocationCoordinate2D) -> Bool {
        lhs.latitude == rhs.latitude && lhs.longitude == rhs.longitude
    }
}
