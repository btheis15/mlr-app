import SwiftUI

// MARK: - FestDinnersDetailView

struct FestDinnersDetailView: View {
    let dinner: FestDinner
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {

                // Header
                VStack(alignment: .leading, spacing: 8) {
                    Text(dinner.title)
                        .font(.festSerif(26, weight: .bold))
                        .foregroundStyle(Color.mlrFest)
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(spacing: 16) {
                        Label(dinner.day, systemImage: "calendar")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.mlrFest.opacity(0.7))
                        Label(dinner.time, systemImage: "clock")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.mlrFest.opacity(0.7))
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 20)

                Divider().background(Color.mlrFest.opacity(0.15))

                // Chef
                DinnerDetailSection(icon: "person.fill", title: "Chef") {
                    HStack(spacing: 10) {
                        Circle()
                            .fill(Color.mlrFest.opacity(0.12))
                            .frame(width: 38, height: 38)
                            .overlay(
                                Text(String(dinner.chef.prefix(1)).uppercased())
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(Color.mlrFest)
                            )
                        Text(dinner.chef)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Color.mlrFest)
                        Spacer()
                    }
                }

                Divider().background(Color.mlrFest.opacity(0.15))

                // Menu
                DinnerDetailSection(icon: "fork.knife", title: "On the Menu") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(menuLines(), id: \.self) { line in
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(Color.mlrFest.opacity(0.4))
                                    .frame(width: 5, height: 5)
                                Text(line)
                                    .font(.system(size: 15))
                                    .foregroundStyle(Color.mlrText)
                            }
                        }
                    }
                }

                Divider().background(Color.mlrFest.opacity(0.15))

                // Location — Protected
                DinnerDetailSection(icon: "mappin.and.ellipse", title: "Location") {
                    if env.isSignedIn {
                        if let loc = dinner.location {
                            Text(loc)
                                .font(.system(size: 15))
                                .foregroundStyle(Color.mlrFest.opacity(0.85))
                        } else {
                            Text("TBD")
                                .font(.system(size: 15))
                                .foregroundStyle(Color.mlrFest.opacity(0.5))
                        }
                    } else {
                        ProtectedField(message: "Sign in to see location")
                    }
                }

                Divider().background(Color.mlrFest.opacity(0.15))

                // Crew — Protected
                DinnerDetailSection(icon: "person.3.fill", title: "Crew") {
                    if env.isSignedIn {
                        if dinner.crew.isEmpty {
                            Text("No crew assigned yet")
                                .font(.system(size: 14))
                                .foregroundStyle(Color.mlrFest.opacity(0.5))
                        } else {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(dinner.crew, id: \.self) { member in
                                    HStack(spacing: 10) {
                                        Circle()
                                            .fill(Color.mlrFest.opacity(0.12))
                                            .frame(width: 32, height: 32)
                                            .overlay(
                                                Text(String(member.prefix(1)).uppercased())
                                                    .font(.system(size: 13, weight: .semibold))
                                                    .foregroundStyle(Color.mlrFest)
                                            )
                                        Text(member)
                                            .font(.system(size: 14, weight: .medium))
                                            .foregroundStyle(Color.mlrFest)
                                        Spacer()
                                    }
                                }
                            }
                        }
                    } else {
                        ProtectedField(message: "Sign in to see crew")
                    }
                }

                Spacer(minLength: 32)
            }
        }
        .background(Color.mlrFestParchment.ignoresSafeArea())
        .navigationTitle(dinner.day)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.mlrFestParchment, for: .navigationBar)
    }

    private func menuLines() -> [String] {
        dinner.menu
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}

// MARK: - Dinner Detail Section

private struct DinnerDetailSection<Content: View>: View {
    let icon: String
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.mlrFest.opacity(0.6))
                Text(title.uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.mlrFest.opacity(0.6))
                    .tracking(0.8)
            }
            content()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
    }
}
