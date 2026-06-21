import SwiftUI
import MapKit
import CoreLocation

// MARK: - Maps Helper
//
// Native MapKit for the location-bearing parts of the app:
//   • "Get Directions" to the resort or a local place → opens Apple Maps.
//   • Help requests carry GPS pins → show on a map + one-tap navigate to whoever
//     needs a hand ("turn-by-turn to the dock").
//   • Local Places → a map of nearby businesses.

enum MapsHelper {
    /// Muskellunge Lake Resort (approx), Tomahawk, WI.
    static let resort = CLLocationCoordinate2D(latitude: 45.4669, longitude: -89.7296)

    /// Open Apple Maps with driving directions to a coordinate.
    static func directions(to coordinate: CLLocationCoordinate2D, name: String) {
        let placemark = MKPlacemark(coordinate: coordinate)
        let item = MKMapItem(placemark: placemark)
        item.name = name
        item.openInMaps(launchOptions: [
            MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving
        ])
    }

    /// Open Apple Maps directions to the resort.
    static func directionsToResort() {
        directions(to: resort, name: "Muskellunge Lake Resort")
    }

    /// Open Apple Maps directions by address string (local places without coords).
    static func directions(toAddress address: String) {
        let q = address.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? address
        if let url = URL(string: "http://maps.apple.com/?daddr=\(q)") {
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - Help request map (navigate to the person who needs help)

struct HelpRequestMap: View {
    let coordinate: CLLocationCoordinate2D
    let title: String

    var body: some View {
        Map(initialPosition: .region(MKCoordinateRegion(
            center: coordinate,
            span: MKCoordinateSpan(latitudeDelta: 0.006, longitudeDelta: 0.006)
        ))) {
            Marker(title, coordinate: coordinate)
                .tint(.mlrPrimary)
        }
        .frame(height: 180)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(alignment: .bottomTrailing) {
            Button {
                MapsHelper.directions(to: coordinate, name: title)
            } label: {
                Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                    .font(.caption.bold())
                    .padding(8)
            }
            .buttonStyle(.glassPrimary)
            .fixedSize()
            .padding(8)
        }
    }
}

// MARK: - Resort / local-places map

struct ResortLocationMap: View {
    var coordinate: CLLocationCoordinate2D = MapsHelper.resort
    var title: String = "Muskellunge Lake Resort"

    var body: some View {
        Map(initialPosition: .region(MKCoordinateRegion(
            center: coordinate,
            span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
        ))) {
            Marker(title, systemImage: "tree.fill", coordinate: coordinate)
                .tint(.mlrPrimary)
        }
    }
}
