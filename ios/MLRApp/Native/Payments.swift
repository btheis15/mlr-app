import SwiftUI
import PassKit

// MARK: - Payments (Apple Pay + Apple Cash handoff)
//
// The app already collects dues and shows Venmo/Zelle/Apple Cash handles. Native
// options, in order of how "Apple-native" they are:
//
// 1) **Apple Cash via Messages** — Apple Cash is person-to-person and has NO public
//    API to send programmatically (by Apple's design). The native path is to open
//    a Message to the payee pre-filled with a note; the sender taps the ⊕ → Apple
//    Cash in Messages to attach the money. `appleCashHandoff` does exactly that.
//
// 2) **Apple Pay (PassKit)** — for *real* dues collection to a single resort
//    account, Apple Pay is the premium flow, but it requires a payment processor
//    (Stripe/Braintree/Square) + an Apple Pay merchant ID. `ApplePayDuesButton`
//    is the scaffold; wire `PKPaymentAuthorizationController` to your processor
//    when/if dues move to a real merchant account. Until then it's hidden behind
//    `PaymentsConfig.applePayEnabled`.
//
// 3) **Existing deep links** — Venmo / Cash App `$cashtag` continue to work as-is.

enum PaymentsConfig {
    /// Flip on once an Apple Pay merchant + processor is configured.
    static let applePayEnabled = false
    static let merchantId = "merchant.com.muskellungelakeresort.mlr"
    static let supportedNetworks: [PKPaymentNetwork] = [.visa, .masterCard, .amex, .discover]
}

enum ApplePayHandoff {
    /// Open Messages to the payee with a prefilled note so they can attach Apple
    /// Cash. `recipient` is a phone number or iMessage email.
    static func appleCashHandoff(recipient: String, amount: String, note: String) -> MessageComposeState {
        MessageComposeState(
            recipients: [recipient],
            body: "\(note) — sending \(amount) via Apple Cash 🌲"
        )
    }
}

// MARK: - Apple Pay dues button (scaffold)

struct ApplePayDuesButton: View {
    let amount: Decimal
    let label: String
    var onAuthorized: (() -> Void)? = nil

    @State private var controller: PKPaymentAuthorizationController?

    var body: some View {
        if PaymentsConfig.applePayEnabled, PKPaymentAuthorizationController.canMakePayments() {
            PayWithApplePayButton(.contribute) {
                startPayment()
            } onError: { _ in }
                .frame(height: 48)
                .payWithApplePayButtonStyle(.automatic)
        } else {
            EmptyView()
        }
    }

    private func startPayment() {
        let request = PKPaymentRequest()
        request.merchantIdentifier = PaymentsConfig.merchantId
        request.supportedNetworks = PaymentsConfig.supportedNetworks
        request.merchantCapabilities = .threeDSecure
        request.countryCode = "US"
        request.currencyCode = "USD"
        request.paymentSummaryItems = [
            PKPaymentSummaryItem(label: label, amount: NSDecimalNumber(decimal: amount)),
            PKPaymentSummaryItem(label: "Muskellunge Lake Resort", amount: NSDecimalNumber(decimal: amount))
        ]
        // NOTE: hand `request` to PKPaymentAuthorizationController + your processor.
        // Left unwired until a merchant account exists (PaymentsConfig.applePayEnabled).
        onAuthorized?()
    }
}
