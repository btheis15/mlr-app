import SwiftUI

// MARK: - LocalPlacesView
// Nearby restaurants and businesses. Mirrors /local-places on the web.

struct LocalPlacesView: View {

    private var golfPlaces: [LocalPlace]   { LocalPlace.all.filter { $0.category == .golf } }
    private var diningPlaces: [LocalPlace] { LocalPlace.all.filter { $0.category == .dining } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                if !golfPlaces.isEmpty {
                    PlacesSection(title: "Golf", emoji: "⛳", places: golfPlaces)
                }
                if !diningPlaces.isEmpty {
                    PlacesSection(title: "Food & Drink", emoji: "🍽️", places: diningPlaces)
                }
            }
            .padding(.vertical, 20)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Local Places")
        .navigationBarTitleDisplayMode(.large)
    }
}

// MARK: - Section

private struct PlacesSection: View {
    let title: String
    let emoji: String
    let places: [LocalPlace]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(emoji).font(.system(size: 22))
                Text(title)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Color.mlrText)
            }
            .padding(.horizontal, 16)

            VStack(spacing: 10) {
                ForEach(places) { place in
                    LocalPlaceCard(place: place)
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

// MARK: - Card

private struct LocalPlaceCard: View {
    let place: LocalPlace

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(place.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.mlrText)
                if let locality = place.address {
                    Text(locality)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.mlrTextMuted)
                }
            }

            if let blurb = place.description {
                Text(blurb)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.mlrTextMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Quick-action chips
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if let raw = place.menuUrl, let url = URL(string: raw) {
                        Link(destination: url) { PlaceChip(label: "Menu", icon: "list.bullet") }
                    }
                    if let raw = place.orderUrl, let url = URL(string: raw) {
                        Link(destination: url) { PlaceChip(label: "Order", icon: "cart") }
                    }
                    if let phone = place.phone, let url = URL(string: "tel:\(phone)") {
                        Link(destination: url) { PlaceChip(label: "Call", icon: "phone") }
                    }
                    if let raw = place.website, let url = URL(string: raw) {
                        Link(destination: url) { PlaceChip(label: "Website", icon: "safari") }
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.mlrCard)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Chip

private struct PlaceChip: View {
    let label: String
    let icon: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .semibold))
            Text(label)
                .font(.system(size: 13, weight: .semibold))
        }
        .foregroundStyle(Color.mlrPrimary)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(Color.mlrPrimaryLight)
        .clipShape(Capsule())
    }
}
