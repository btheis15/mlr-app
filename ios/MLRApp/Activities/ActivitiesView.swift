import SwiftUI

// MARK: - ActivitiesView
// Resort activities grouped by category (Water / Land / Evening).
// Static — backed by the ResortActivity.all seed array, no backend.

struct ActivitiesView: View {

    // Preferred category display order; unknown categories fall to the end.
    private let categoryOrder = ["Water", "Land", "Evening"]

    private var grouped: [(category: String, activities: [ResortActivity])] {
        let byCategory = Dictionary(grouping: ResortActivity.all, by: \.category)
        return byCategory
            .sorted { a, b in
                let ai = categoryOrder.firstIndex(of: a.key) ?? Int.max
                let bi = categoryOrder.firstIndex(of: b.key) ?? Int.max
                if ai == bi { return a.key < b.key }
                return ai < bi
            }
            .map { ($0.key, $0.value.sorted { $0.title < $1.title }) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    ForEach(grouped, id: \.category) { group in
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 8) {
                                Image(systemName: icon(for: group.category))
                                    .foregroundStyle(Color.mlrPrimary)
                                Text(group.category)
                                    .font(.system(size: 20, weight: .bold))
                                    .foregroundStyle(Color.mlrText)
                            }
                            .padding(.horizontal, 16)

                            VStack(spacing: 10) {
                                ForEach(group.activities) { activity in
                                    ActivityCard(activity: activity)
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                }
                .padding(.vertical, 20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Activities")
        }
    }

    private func icon(for category: String) -> String {
        switch category {
        case "Water":   return "water.waves"
        case "Land":    return "tree.fill"
        case "Evening": return "moon.stars.fill"
        default:        return "star.fill"
        }
    }
}

// MARK: - Activity Card

private struct ActivityCard: View {
    let activity: ResortActivity

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text(activity.icon)
                .font(.system(size: 30))
                .frame(width: 48, height: 48)
                .background(Color.mlrPrimaryLight)
                .clipShape(RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 4) {
                Text(activity.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.mlrText)
                Text(activity.description)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.mlrTextMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.mlrCard)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
