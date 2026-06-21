import SwiftUI

// MARK: - FestScheduleDetailView

struct FestScheduleDetailView: View {
    let item: ScheduleItem
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {

                // Header
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.title)
                        .font(.festSerif(26, weight: .bold))
                        .foregroundStyle(Color.mlrFest)
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(spacing: 16) {
                        Label(item.day, systemImage: "calendar")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.mlrFest.opacity(0.7))
                        Label(item.time, systemImage: "clock")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.mlrFest.opacity(0.7))
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 20)

                Divider()
                    .background(Color.mlrFest.opacity(0.15))

                // Location
                if let location = item.location {
                    DetailSection(icon: "mappin.and.ellipse", title: "Location") {
                        if env.isSignedIn {
                            Text(location)
                                .font(.system(size: 15))
                                .foregroundStyle(Color.mlrFest.opacity(0.85))
                        } else {
                            ProtectedField(message: "Sign in to see location")
                        }
                    }

                    Divider()
                        .background(Color.mlrFest.opacity(0.15))
                }

                // Description
                if let description = item.description {
                    DetailSection(icon: "text.alignleft", title: "About") {
                        Text(description)
                            .font(.system(size: 15))
                            .foregroundStyle(Color.mlrText)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Divider()
                        .background(Color.mlrFest.opacity(0.15))
                }

                // Leads
                if !item.leads.isEmpty {
                    DetailSection(icon: "person.fill", title: "Leads") {
                        if env.isSignedIn {
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(item.leads, id: \.self) { lead in
                                    LeadRow(name: lead)
                                }
                            }
                        } else {
                            ProtectedField(message: "Sign in to see leads & contacts")
                        }
                    }
                }

                Spacer(minLength: 32)
            }
        }
        .background(Color.mlrFestParchment.ignoresSafeArea())
        .navigationTitle(item.day)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.mlrFestParchment, for: .navigationBar)
    }
}

// MARK: - Detail Section Wrapper

private struct DetailSection<Content: View>: View {
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

// MARK: - Lead Row

private struct LeadRow: View {
    let name: String

    var body: some View {
        HStack(spacing: 12) {
            // Avatar placeholder
            Circle()
                .fill(Color.mlrFest.opacity(0.15))
                .frame(width: 36, height: 36)
                .overlay(
                    Text(String(name.prefix(1)).uppercased())
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Color.mlrFest)
                )

            Text(name)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color.mlrFest)

            Spacer()

            // Contact buttons
            HStack(spacing: 8) {
                Button {
                    // Phone action — requires real phone data from profiles
                } label: {
                    Image(systemName: "phone.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.mlrFest)
                        .padding(8)
                        .background(Color.mlrFest.opacity(0.1))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)

                Button {
                    // Message action
                } label: {
                    Image(systemName: "message.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.mlrFest)
                        .padding(8)
                        .background(Color.mlrFest.opacity(0.1))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Protected Field

struct ProtectedField: View {
    let message: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "lock.fill")
                .font(.system(size: 12))
            Text(message)
                .font(.system(size: 14))
        }
        .foregroundStyle(Color.mlrFest.opacity(0.5))
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.mlrFest.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
