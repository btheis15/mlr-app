import SwiftUI

// MARK: - MemberSheetView
// Full member profile sheet: avatar, name, bio, contact + payment rows
// (all Protected for guests), birthday with no year, admin badge.
// If viewing your own profile, offers an "Edit Profile" link.

struct MemberSheetView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    let member: Profile

    private var isOwnProfile: Bool {
        env.currentProfile?.id == member.id
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    header

                    if let bio = member.bio, !bio.isEmpty {
                        bioSection(bio)
                    }

                    contactSection
                    paymentSection
                    birthdaySection

                    if isOwnProfile {
                        NavigationLink {
                            // Profile editing lives in the Profile tab; this is the entry point.
                            EditProfilePlaceholder()
                        } label: {
                            Text("Edit Profile")
                                .secondaryButton()
                        }
                        .padding(.top, 4)
                    }
                }
                .padding(20)
            }
            .background(Color.mlrSurface)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    CloseButton { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.hidden)
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 12) {
            AvatarView(profile: member, size: .xlarge)

            VStack(spacing: 6) {
                HStack(spacing: 8) {
                    PrivateName(profile: member,
                                font: .system(size: 24, weight: .bold))
                    if member.isAdmin {
                        Label("Admin", systemImage: "checkmark.seal.fill")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.mlrPrimary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.mlrPrimaryLight)
                            .clipShape(Capsule())
                    }
                }
                if member.betaTester {
                    Text("Beta Tester")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.mlrFest)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Bio

    private func bioSection(_ bio: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "About")
            Text(bio)
                .font(.mlrBody)
                .foregroundStyle(Color.mlrText)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .cardStyle()
    }

    // MARK: - Contact

    private var contactSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Contact")
            Protected {
                VStack(spacing: 10) {
                    if let phone = member.phone, !phone.isEmpty {
                        let digits = phone.filter(\.isNumber)
                        contactRow("Call", MLRFormat.phone(phone), "phone.fill",
                                   url: "tel://\(digits)")
                        contactRow("Text", MLRFormat.phone(phone), "message.fill",
                                   url: "sms://\(digits)")
                    }
                    if !member.email.isEmpty {
                        contactRow("Email", member.email, "envelope.fill",
                                   url: "mailto:\(member.email)")
                    }
                    if (member.phone?.isEmpty ?? true) && member.email.isEmpty {
                        Text("No contact info on file.")
                            .font(.mlrCaption)
                            .foregroundStyle(Color.mlrTextMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .padding(16)
        .cardStyle()
    }

    // MARK: - Payment

    @ViewBuilder
    private var paymentSection: some View {
        if member.hasPaymentHandle {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: "Send a payment")
                Protected {
                    VStack(spacing: 10) {
                        if let venmo = member.venmoHandle, !venmo.isEmpty {
                            let handle = venmo.replacingOccurrences(of: "@", with: "")
                            contactRow("Venmo", "@\(handle)", "dollarsign.circle.fill",
                                       url: "venmo://users/\(handle)")
                        }
                        if let zelle = member.zelleHandle, !zelle.isEmpty {
                            contactRow("Zelle", zelle, "z.circle.fill", url: nil)
                        }
                        if let cash = member.appleCashHandle, !cash.isEmpty {
                            contactRow("Apple Cash", cash, "applelogo", url: nil)
                        }
                    }
                }
            }
            .padding(16)
            .cardStyle()
        }
    }

    // MARK: - Birthday (month + day, no year)

    @ViewBuilder
    private var birthdaySection: some View {
        if let birthday = member.birthday, let display = monthDay(from: birthday) {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: "Birthday")
                Protected {
                    Label(display, systemImage: "gift.fill")
                        .font(.mlrBody)
                        .foregroundStyle(Color.mlrText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(16)
            .cardStyle()
        }
    }

    // MARK: - Row helper

    @ViewBuilder
    private func contactRow(_ label: String, _ value: String, _ icon: String, url: String?) -> some View {
        let row = HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(Color.mlrPrimary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.mlrTextMuted)
                Text(value)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.mlrText)
            }
            Spacer()
            if url != nil {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.mlrTextSubtle)
            }
        }
        .contentShape(Rectangle())

        if let url, let link = URL(string: url) {
            Link(destination: link) { row }
        } else {
            row
        }
    }

    // MARK: - Birthday parsing

    private func monthDay(from iso: String) -> String? {
        // Stored as "yyyy-MM-dd" or "MM-dd"; render "Month Day", no year.
        let inFmt = DateFormatter()
        inFmt.locale = Locale(identifier: "en_US_POSIX")
        inFmt.dateFormat = "yyyy-MM-dd"
        var date = inFmt.date(from: iso)
        if date == nil {
            inFmt.dateFormat = "MM-dd"
            date = inFmt.date(from: iso)
        }
        guard let date else { return nil }
        let outFmt = DateFormatter()
        outFmt.dateFormat = "MMMM d"
        return outFmt.string(from: date)
    }
}

// MARK: - Edit Profile placeholder destination

private struct EditProfilePlaceholder: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.text.rectangle")
                .font(.system(size: 36))
                .foregroundStyle(Color.mlrPrimary)
            Text("Edit your profile from the Profile tab.")
                .font(.mlrBody)
                .foregroundStyle(Color.mlrTextMuted)
                .multilineTextAlignment(.center)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.mlrSurface)
        .navigationTitle("Edit Profile")
        .navigationBarTitleDisplayMode(.inline)
    }
}
