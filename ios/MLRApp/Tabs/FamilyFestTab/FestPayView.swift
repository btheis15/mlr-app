import SwiftUI

// MARK: - Payment Method Model

private struct PaymentMethod: Identifiable {
    let id: String
    let name: String
    let icon: String
    let iconColor: Color
    let handle: String
    let amount: Int
    let description: String
    let deepLink: URL?
    let displayHandle: String
}

// MARK: - FestPayView

struct FestPayView: View {
    @Environment(AppEnvironment.self) private var env

    private let dueAmount = 150
    private let note = "FamilyFest2026"

    private var paymentMethods: [PaymentMethod] {
        [
            PaymentMethod(
                id: "venmo",
                name: "Venmo",
                icon: "v.circle.fill",
                iconColor: Color(hex: "#3d95ce"),
                handle: "MLRFamilyFest",
                amount: dueAmount,
                description: "Send via Venmo",
                deepLink: URL(string: "venmo://paycharge?txn=pay&recipients=MLRFamilyFest&amount=\(dueAmount)&note=\(note)"),
                displayHandle: "@MLRFamilyFest"
            ),
            PaymentMethod(
                id: "applepay",
                name: "Apple Cash",
                icon: "applelogo",
                iconColor: Color.mlrText, // adaptive: black in light, white in dark
                handle: "cash.app/$MLRFamilyFest",
                amount: dueAmount,
                description: "Send with Apple Cash",
                deepLink: URL(string: "https://cash.app/$MLRFamilyFest"),
                displayHandle: "$MLRFamilyFest"
            ),
            PaymentMethod(
                id: "zelle",
                name: "Zelle",
                icon: "z.circle.fill",
                iconColor: Color(hex: "#6d1ed4"),
                handle: "familyfest@muskellungelake.com",
                amount: dueAmount,
                description: "Send to email via Zelle",
                deepLink: nil,
                displayHandle: "familyfest@muskellungelake.com"
            ),
        ]
    }

    var body: some View {
        if !env.isSignedIn {
            FestSignInNotice(message: "Sign in to see payment details and handles.")
        } else {
            payContent
        }
    }

    private var payContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {

                // Dues explanation card
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Image(systemName: "dollarsign.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(Color.mlrFest)
                        Text("Household Dues")
                            .font(.festSerif(16, weight: .bold))
                            .foregroundStyle(Color.mlrFest)
                    }

                    Text("$\(dueAmount) per household · Family Fest 2026")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.mlrFest.opacity(0.8))

                    Text("Dues cover shared meals, activities, and resort costs for the week. Pay with any method below — note "Family Fest 2026" with your payment.")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.mlrFest.opacity(0.65))
                        .fixedSize(horizontal: false, vertical: true)
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

                // Apple Pay dues button — self-hides until a merchant + processor
                // is configured (PaymentsConfig.applePayEnabled).
                ApplePayDuesButton(amount: Decimal(dueAmount), label: "Family Fest Dues")
                    .padding(.horizontal, 16)

                // Payment methods
                VStack(spacing: 10) {
                    ForEach(paymentMethods) { method in
                        PaymentMethodCard(method: method)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
        }
        .background(Color.mlrFestParchment)
    }
}

// MARK: - Payment Method Card

private struct PaymentMethodCard: View {
    let method: PaymentMethod
    @State private var copied = false
    @State private var composeState: MessageComposeState?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {

            // Header
            HStack(spacing: 10) {
                Image(systemName: method.icon)
                    .font(.system(size: 22))
                    .foregroundStyle(method.iconColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text(method.name)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Color.mlrFest)
                    Text(method.description)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.mlrFest.opacity(0.6))
                }
                Spacer()
                Text("$\(method.amount)")
                    .font(.festSerif(18, weight: .bold))
                    .foregroundStyle(Color.mlrFest)
            }

            // Handle display + copy
            HStack(spacing: 8) {
                Text(method.displayHandle)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Color.mlrFest.opacity(0.75))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.mlrFest.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    UIPasteboard.general.string = method.displayHandle
                    copied = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        copied = false
                    }
                } label: {
                    Label(copied ? "Copied!" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(copied ? Color.mlrSuccess : Color.mlrFest.opacity(0.7))
                }
                .buttonStyle(.plain)
                .animation(.easeInOut(duration: 0.2), value: copied)
            }

            // Apple Cash → hand off to Messages (Apple Cash has no programmatic
            // send API; the sender attaches the cash in the Messages thread).
            if method.id == "applepay" {
                Button {
                    composeState = ApplePayHandoff.appleCashHandoff(
                        recipient: method.handle,
                        amount: "$\(method.amount)",
                        note: "Family Fest dues"
                    )
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "applelogo")
                            .font(.system(size: 14))
                        Text("Send with Apple Cash")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(Color.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.mlrFest)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }

            // Deep link button (Venmo / Cash App)
            if let deepLink = method.deepLink {
                Link(destination: deepLink) {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.up.right.square")
                            .font(.system(size: 14))
                        Text("Open \(method.name)")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(Color.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(method.iconColor)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            } else {
                // Zelle — no deep link, just instructions
                Text("Open your bank app → Zelle → send to the address above")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.mlrFest.opacity(0.55))
            }
        }
        .padding(16)
        .background(Color.mlrFestParchment)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(Color.mlrFest.opacity(0.2), lineWidth: 1)
        )
        .messageComposer($composeState)
    }
}
