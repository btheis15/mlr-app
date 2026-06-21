import Foundation
import WeatherKit
import CoreLocation

// MARK: - Weather Service (WeatherKit)
//
// Fetches the forecast for resort events. WeatherKit's daily forecast reaches ~10
// days out, so near-term events get a forecast and far-out ones simply don't — the
// UI hides the badge when `forecast(for:)` returns nil.
//
// Requirements:
//   • Add the WeatherKit capability to the App ID (developer.apple.com) and the
//     Xcode target (Signing & Capabilities → + WeatherKit).
//   • Add NSLocationWhenInUseUsageDescription if you ever resolve "my location";
//     for events we use the fixed resort coordinate so no permission is needed.
//   • Apple requires attribution — see `WeatherAttribution` usage in the UI.
//
// All resort events happen at the resort, so we anchor every forecast to the
// resort's coordinate rather than the device location.

@Observable
final class WeatherService {
    static let shared = WeatherService()

    /// Muskellunge Lake Resort, Tomahawk, WI (approx).
    static let resortCoordinate = CLLocationCoordinate2D(latitude: 45.4669, longitude: -89.7296)

    private let service = WeatherKit.WeatherService.shared
    private let maxForecastDays = 10

    /// Cache keyed by ISO date string so we don't refetch per card.
    private var cache: [String: EventForecast] = [:]
    private var inFlight: Set<String> = []

    private init() {}

    /// Returns a forecast for an event's start date if WeatherKit has one
    /// (i.e. the date is within the daily-forecast horizon), otherwise nil.
    @MainActor
    func forecast(forISODate iso: String,
                  coordinate: CLLocationCoordinate2D = WeatherService.resortCoordinate) async -> EventForecast? {
        if let cached = cache[iso] { return cached }

        guard let targetDate = Self.isoFormatter.date(from: iso) else { return nil }
        let cal = Calendar.current
        let daysOut = cal.dateComponents([.day],
                                         from: cal.startOfDay(for: .now),
                                         to: cal.startOfDay(for: targetDate)).day ?? 999
        // Past events and events beyond the forecast horizon get nothing.
        guard daysOut >= 0, daysOut <= maxForecastDays else { return nil }
        guard !inFlight.contains(iso) else { return nil }
        inFlight.insert(iso)
        defer { inFlight.remove(iso) }

        do {
            let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
            let daily = try await service.weather(for: location, including: .daily)
            guard let day = daily.first(where: {
                cal.isDate($0.date, inSameDayAs: targetDate)
            }) else { return nil }

            let forecast = EventForecast(
                isoDate: iso,
                highC: day.highTemperature.value,
                lowC: day.lowTemperature.value,
                highF: day.highTemperature.converted(to: .fahrenheit).value,
                lowF: day.lowTemperature.converted(to: .fahrenheit).value,
                symbolName: day.symbolName,
                condition: day.condition.description,
                precipitationChance: day.precipitationChance
            )
            cache[iso] = forecast
            return forecast
        } catch {
            print("[WeatherService] forecast error for \(iso): \(error)")
            return nil
        }
    }

    static let isoFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "America/Chicago")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
}

// MARK: - Forecast model

struct EventForecast: Identifiable, Equatable {
    var id: String { isoDate }
    let isoDate: String
    let highC: Double
    let lowC: Double
    let highF: Double
    let lowF: Double
    let symbolName: String   // SF Symbol from WeatherKit (e.g. "cloud.sun.fill")
    let condition: String    // e.g. "Partly Cloudy"
    let precipitationChance: Double // 0...1

    func highLabel(fahrenheit: Bool = true) -> String {
        fahrenheit ? "\(Int(highF.rounded()))°" : "\(Int(highC.rounded()))°"
    }
    func lowLabel(fahrenheit: Bool = true) -> String {
        fahrenheit ? "\(Int(lowF.rounded()))°" : "\(Int(lowC.rounded()))°"
    }
    var precipPercent: Int { Int((precipitationChance * 100).rounded()) }
}
