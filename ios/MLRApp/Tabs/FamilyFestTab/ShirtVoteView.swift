import SwiftUI

// MARK: - ShirtVoteView
// Shown during the planning phase only, before the vote deadline.
// Hands off to the committee's Google Form — no in-app vote capture.

struct ShirtVoteView: View {
    let season: FestSeason
    @State private var lightboxDesign: TshirtDesign?

    // Parse the deadline for display
    private var deadlineFormatted: String {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        fmt.timeZone = TimeZone(identifier: "America/Chicago")
        guard let date = fmt.date(from: TshirtVoteConfig.deadline) else {
            return TshirtVoteConfig.deadline
        }
        let display = DateFormatter()
        display.dateStyle = .medium
        display.timeStyle = .none
        display.timeZone = TimeZone(identifier: "America/Chicago")
        return display.string(from: date)
    }

    private var isPastDeadline: Bool {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        fmt.timeZone = TimeZone(identifier: "America/Chicago")
        guard let deadline = fmt.date(from: TshirtVoteConfig.deadline) else { return false }
        return Date() > deadline
    }

    var body: some View {
        if !season.isPlanning || isPastDeadline {
            notAvailableView
        } else {
            voteContent
        }
    }

    // MARK: - Not Available

    private var notAvailableView: some View {
        VStack(spacing: 16) {
            Spacer(minLength: 40)
            Image(systemName: "tshirt.fill")
                .font(.system(size: 40))
                .foregroundStyle(Color.mlrFest.opacity(0.3))
            Text("T-Shirt Vote")
                .font(.festSerif(18, weight: .bold))
                .foregroundStyle(Color.mlrFest.opacity(0.5))
            Text(isPastDeadline
                 ? "Voting has closed. Results coming soon!"
                 : "T-shirt voting opens closer to the Fest.")
                .font(.system(size: 14))
                .foregroundStyle(Color.mlrFest.opacity(0.45))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer(minLength: 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.mlrFestParchment)
    }

    // MARK: - Vote Content

    private var voteContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {

                // Header
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text("🗳️")
                            .font(.system(size: 22))
                        Text("Vote for the 2026 Shirt")
                            .font(.festSerif(18, weight: .bold))
                            .foregroundStyle(Color.mlrFest)
                    }

                    Text("Browse the designs below, then open the poll to cast your vote and RSVP.")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.mlrFest.opacity(0.65))

                    HStack(spacing: 6) {
                        Image(systemName: "calendar.badge.exclamationmark")
                            .font(.system(size: 12))
                        Text("Voting closes \(deadlineFormatted)")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundStyle(Color.mlrFest.opacity(0.55))

                    if TshirtVoteConfig.rankedChoice {
                        HStack(spacing: 6) {
                            Image(systemName: "list.number")
                                .font(.system(size: 12))
                            Text("Ranked-choice · Voters \(TshirtVoteConfig.minVoterAge)+ years old")
                                .font(.system(size: 12))
                        }
                        .foregroundStyle(Color.mlrFest.opacity(0.5))
                    }
                }
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 14)
                        .fill(Color.mlrFest.opacity(0.07))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .strokeBorder(Color.mlrFest.opacity(0.2), lineWidth: 1.5)
                        )
                )
                .padding(.horizontal, 16)
                .padding(.top, 12)

                // Design gallery
                if TshirtVoteConfig.designs.isEmpty {
                    DesignPlaceholder()
                        .padding(.horizontal, 16)
                } else {
                    VStack(spacing: 14) {
                        ForEach(TshirtVoteConfig.designs) { design in
                            ShirtDesignCard(design: design) {
                                lightboxDesign = design
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                }

                // CTA button
                Button {
                    if let url = URL(string: TshirtVoteConfig.formUrl) {
                        Haptics.success()
                        UIApplication.shared.open(url)
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.up.right.square")
                            .font(.system(size: 15))
                        Text("Open the Poll to Vote & RSVP")
                    }
                }
                .buttonStyle(.glassFest)
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
        }
        .background(Color.mlrFestParchment)
        .sheet(item: $lightboxDesign) { design in
            ShirtDesignLightbox(design: design)
        }
    }
}

// MARK: - Shirt Design Card

private struct ShirtDesignCard: View {
    let design: TshirtDesign
    let onTapImage: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {

            // Design image
            Button(action: onTapImage) {
                Group {
                    if !design.imageName.isEmpty {
                        Image(design.imageName)
                            .resizable()
                            .scaledToFit()
                    } else {
                        // Placeholder when no image asset is bundled
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.mlrFest.opacity(0.08))
                            .frame(height: 200)
                            .overlay(
                                VStack(spacing: 8) {
                                    Image(systemName: "tshirt.fill")
                                        .font(.system(size: 40))
                                        .foregroundStyle(Color.mlrFest.opacity(0.3))
                                    Text(design.name)
                                        .font(.festSerif(14))
                                        .foregroundStyle(Color.mlrFest.opacity(0.5))
                                }
                            )
                    }
                }
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)

            // Metadata
            VStack(alignment: .leading, spacing: 4) {
                Text(design.name)
                    .font(.festSerif(16, weight: .bold))
                    .foregroundStyle(Color.mlrFest)
                Text("by \(design.artist)")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.mlrFest.opacity(0.6))
                Text(design.blurb)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.mlrFest.opacity(0.7))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
        .padding(14)
        .background(Color.mlrFestParchment)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(Color.mlrFest.opacity(0.2), lineWidth: 1)
        )
    }
}

// MARK: - Design Lightbox

private struct ShirtDesignLightbox: View {
    let design: TshirtDesign
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                VStack(spacing: 16) {
                    if !design.imageName.isEmpty {
                        Image(design.imageName)
                            .resizable()
                            .scaledToFit()
                            .padding(.horizontal, 20)
                    } else {
                        Image(systemName: "tshirt.fill")
                            .font(.system(size: 80))
                            .foregroundStyle(Color.white.opacity(0.3))
                    }

                    VStack(spacing: 4) {
                        Text(design.name)
                            .font(.festSerif(18, weight: .bold))
                            .foregroundStyle(Color.white)
                        Text("by \(design.artist)")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.white.opacity(0.7))
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(Color.white)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

// MARK: - Design Placeholder (no designs configured yet)

private struct DesignPlaceholder: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "photo.on.rectangle")
                .font(.system(size: 36))
                .foregroundStyle(Color.mlrFest.opacity(0.3))
            Text("Designs coming soon")
                .font(.festSerif(14))
                .foregroundStyle(Color.mlrFest.opacity(0.5))
            Text("Update TshirtVoteConfig.designs in SeedData.swift when the committee finalizes the options.")
                .font(.system(size: 12))
                .foregroundStyle(Color.mlrFest.opacity(0.4))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.mlrFest.opacity(0.05))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(Color.mlrFest.opacity(0.15), lineWidth: 1)
                )
        )
    }
}
