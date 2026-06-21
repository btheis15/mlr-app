import SwiftUI
import WeatherKit

// MARK: - Event Weather Badge
//
// Drop-in badge that shows the forecast for an event's date when WeatherKit has
// one, and renders nothing otherwise (far-out events → no badge). Use on
// EventCard, EventSheet, UpcomingEventCard, and the Family Fest day rows.
//
//   EventWeatherBadge(isoDate: event.startDate)
//
// Apple's attribution requirement is satisfied by `WeatherAttributionLink` in the
// event detail (EventSheet) — the small badge links there. Place at least one
// `WeatherAttributionLink` on any screen that displays WeatherKit data.

struct EventWeatherBadge: View {
    let isoDate: String
    var compact: Bool = true

    @State private var forecast: EventForecast?
    @State private var didLoad = false

    var body: some View {
        Group {
            if let f = forecast {
                if compact {
                    compactBadge(f)
                } else {
                    fullBadge(f)
                }
            } else {
                EmptyView()
            }
        }
        .task(id: isoDate) {
            guard !didLoad else { return }
            didLoad = true
            forecast = await WeatherService.shared.forecast(forISODate: isoDate)
        }
    }

    private func compactBadge(_ f: EventForecast) -> some View {
        HStack(spacing: 4) {
            Image(systemName: f.symbolName)
                .symbolRenderingMode(.multicolor)
                .font(.caption)
            Text("\(f.highLabel())/\(f.lowLabel())")
                .font(.caption2.weight(.medium))
                .monospacedDigit()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .glassEffect(.clear, in: .capsule)
        .accessibilityLabel("Forecast \(f.condition), high \(f.highLabel()), low \(f.lowLabel())")
    }

    private func fullBadge(_ f: EventForecast) -> some View {
        HStack(spacing: 12) {
            Image(systemName: f.symbolName)
                .symbolRenderingMode(.multicolor)
                .font(.title)
            VStack(alignment: .leading, spacing: 2) {
                Text(f.condition)
                    .font(.subheadline.weight(.semibold))
                HStack(spacing: 8) {
                    Label("\(f.highLabel()) / \(f.lowLabel())", systemImage: "thermometer.medium")
                        .font(.caption)
                    if f.precipPercent > 0 {
                        Label("\(f.precipPercent)%", systemImage: "drop.fill")
                            .font(.caption)
                            .foregroundStyle(.blue)
                    }
                }
                .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding()
        .glassCard(cornerRadius: 14)
    }
}

// MARK: - Attribution (required by Apple's WeatherKit terms)

struct WeatherAttributionView: View {
    @State private var attribution: WeatherAttribution?

    var body: some View {
        Group {
            if let attribution {
                HStack(spacing: 4) {
                    AsyncImage(url: attribution.combinedMarkLightURL) { image in
                        image.resizable().scaledToFit()
                    } placeholder: {
                        Text("Weather")
                    }
                    .frame(height: 12)
                    Link("Data sources", destination: attribution.legalPageURL)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .task {
            attribution = try? await WeatherKit.WeatherService.shared.attribution
        }
    }
}
