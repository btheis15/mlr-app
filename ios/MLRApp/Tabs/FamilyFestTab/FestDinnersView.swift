import SwiftUI

// MARK: - FestDinnersView

struct FestDinnersView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                ForEach(FestDinner.seed) { dinner in
                    NavigationLink(destination: FestDinnersDetailView(dinner: dinner)) {
                        DinnerCard(dinner: dinner)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
        .background(Color.mlrFestParchment)
    }
}

// MARK: - Dinner Card

private struct DinnerCard: View {
    let dinner: FestDinner

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            // Day medallion
            VStack(spacing: 2) {
                Text(shortDay(dinner.day))
                    .font(.festSerif(11))
                    .foregroundStyle(Color.mlrFest.opacity(0.6))
                Text(mealNumber(dinner.day))
                    .font(.festSerif(22, weight: .bold))
                    .foregroundStyle(Color.mlrFest)
            }
            .frame(width: 48, height: 52)
            .background(Color.mlrFest.opacity(0.07))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(Color.mlrFest.opacity(0.2), lineWidth: 1)
            )

            // Content
            VStack(alignment: .leading, spacing: 4) {
                Text(dinner.title)
                    .font(.festSerif(15, weight: .bold))
                    .foregroundStyle(Color.mlrFest)
                    .multilineTextAlignment(.leading)

                HStack(spacing: 4) {
                    Image(systemName: "person.fill")
                        .font(.system(size: 11))
                    Text(dinner.chef)
                        .font(.system(size: 13))
                }
                .foregroundStyle(Color.mlrFest.opacity(0.65))

                Text(dinner.time)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.mlrFest.opacity(0.5))
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.mlrFest.opacity(0.3))
        }
        .padding(14)
        .background(Color.mlrFestParchment)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(Color.mlrFest.opacity(0.2), lineWidth: 1)
        )
    }

    private func shortDay(_ day: String) -> String {
        String(day.prefix(3)).uppercased()
    }

    private func mealNumber(_ day: String) -> String {
        let order = ["Sunday": "1", "Monday": "2", "Tuesday": "3",
                     "Wednesday": "4", "Thursday": "5", "Friday": "6", "Saturday": "7"]
        return order[day] ?? "–"
    }
}
