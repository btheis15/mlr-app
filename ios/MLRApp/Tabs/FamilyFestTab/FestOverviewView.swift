import SwiftUI

// MARK: - Fest Section Enum

enum FestSection: String, CaseIterable, Identifiable {
    case overview  = "Overview"
    case schedule  = "Schedule"
    case dinners   = "Dinners"
    case crew      = "Crew"
    case photos    = "Photos"
    case pay       = "Pay"
    case shirts    = "Shirts"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .overview:  return "star.fill"
        case .schedule:  return "calendar"
        case .dinners:   return "fork.knife"
        case .crew:      return "person.3.fill"
        case .photos:    return "photo.fill"
        case .pay:       return "dollarsign.circle.fill"
        case .shirts:    return "tshirt.fill"
        }
    }
}

// MARK: - FestOverviewView

struct FestOverviewView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var selectedSection: FestSection = .overview
    @State private var festSeason: FestSeason = .current()

    var body: some View {
        NavigationStack {
            ZStack {
                Color.mlrFestParchment.ignoresSafeArea()

                VStack(spacing: 0) {
                    // FestStatus at top
                    FestStatus(season: festSeason)
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 8)

                    // Section sub-nav chips
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(FestSection.allCases) { section in
                                // Hide Shirts outside planning phase
                                if section == .shirts && !festSeason.isPlanning {
                                    EmptyView()
                                } else {
                                    FestNavChip(
                                        label: section.rawValue,
                                        icon: section.icon,
                                        isSelected: selectedSection == section
                                    ) {
                                        withAnimation(.easeInOut(duration: 0.2)) {
                                            selectedSection = section
                                        }
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                    }

                    Divider()
                        .background(Color.mlrFest.opacity(0.2))

                    // Section content
                    Group {
                        switch selectedSection {
                        case .overview:
                            FestOverviewSectionView(season: festSeason)
                        case .schedule:
                            FestScheduleView()
                        case .dinners:
                            FestDinnersView()
                        case .crew:
                            FestCrewView()
                        case .photos:
                            FestPhotosView()
                        case .pay:
                            FestPayView()
                        case .shirts:
                            ShirtVoteView(season: festSeason)
                        }
                    }
                }
            }
            .navigationTitle("Family Fest")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.mlrFestParchment, for: .navigationBar)
            .toolbarColorScheme(.light, for: .navigationBar)
        }
        .onAppear {
            festSeason = .current()
        }
    }
}

// MARK: - Nav Chip

private struct FestNavChip: View {
    let label: String
    let icon: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                Text(label)
                    .font(.festSerif(13))
            }
            .foregroundStyle(isSelected ? Color.white : Color.mlrFest)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                isSelected
                    ? Color.mlrFest
                    : Color.mlrFest.opacity(0.1)
            )
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(Color.mlrFest.opacity(isSelected ? 0 : 0.3), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Overview Section (Home/Hub content)

private struct FestOverviewSectionView: View {
    let season: FestSeason

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {

                // Poster / hero card
                FestPosterCard()

                // Next-up preview
                FestNextUpCard(season: season)

                // Heritage footnote
                Text("Leo & Dorothy Theis · Est. 1987 · Tomahawk, WI")
                    .font(.festSerif(11))
                    .foregroundStyle(Color.mlrFest.opacity(0.6))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.bottom, 4)
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 32)
        }
    }
}

// MARK: - Poster Card

private struct FestPosterCard: View {
    var body: some View {
        VStack(spacing: 10) {
            Text("Family Fest")
                .font(.festSerif(30, weight: .bold))
                .foregroundStyle(Color.mlrFest)
            Text("2026 · Muskellunge Lake Resort")
                .font(.festSerif(14))
                .foregroundStyle(Color.mlrFest.opacity(0.75))
            Text("\(FamilyFestConfig.dateRangeLabel) · Tomahawk, Wisconsin")
                .font(.festSerif(13))
                .foregroundStyle(Color.mlrFest.opacity(0.6))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 20)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.mlrFestParchment)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(Color.mlrFest.opacity(0.25), lineWidth: 1.5)
                )
        )
    }
}

// MARK: - Next Up Card

private struct FestNextUpCard: View {
    let season: FestSeason

    var body: some View {
        if let nextItem = ScheduleItem.seed.first {
            VStack(alignment: .leading, spacing: 8) {
                Text("First Up")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.mlrFest.opacity(0.6))
                    .tracking(0.8)
                    .textCase(.uppercase)

                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(nextItem.title)
                            .font(.festSerif(16, weight: .bold))
                            .foregroundStyle(Color.mlrFest)
                        Text("\(nextItem.day) · \(nextItem.time)")
                            .font(.festSerif(13))
                            .foregroundStyle(Color.mlrFest.opacity(0.7))
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.mlrFest.opacity(0.4))
                }
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.mlrFest.opacity(0.06))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(Color.mlrFest.opacity(0.18), lineWidth: 1)
                    )
            )
        }
    }
}
