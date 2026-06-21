import Foundation
import Contacts
import ContactsUI
import SwiftUI

// MARK: - Contacts Service
//
// "Add to Contacts" from a member's profile — so the family directory lands in the
// user's real Contacts (with phone, email, and the MLR avatar). Uses the system
// `CNContactViewController` (new-contact) so the user reviews + confirms; no
// silent writes, and no broad contacts permission needed for the add-card flow.

struct AddToContactsView: UIViewControllerRepresentable {
    let name: String
    let phone: String?
    let email: String?
    let imageData: Data?

    func makeUIViewController(context: Context) -> UINavigationController {
        let contact = CNMutableContact()
        let parts = name.split(separator: " ", maxSplits: 1).map(String.init)
        contact.givenName = parts.first ?? name
        contact.familyName = parts.count > 1 ? parts[1] : ""

        if let phone {
            contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMobile,
                                                   value: CNPhoneNumber(stringValue: phone))]
        }
        if let email {
            contact.emailAddresses = [CNLabeledValue(label: CNLabelHome, value: email as NSString)]
        }
        if let imageData { contact.imageData = imageData }
        contact.organizationName = "Muskellunge Lake Resort"

        let vc = CNContactViewController(forNewContact: contact)
        vc.delegate = context.coordinator
        return UINavigationController(rootViewController: vc)
    }

    func updateUIViewController(_ vc: UINavigationController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, CNContactViewControllerDelegate {
        func contactViewController(_ viewController: CNContactViewController,
                                   didCompleteWith contact: CNContact?) {
            viewController.dismiss(animated: true)
        }
    }
}
