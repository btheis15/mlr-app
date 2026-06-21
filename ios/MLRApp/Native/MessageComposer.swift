import SwiftUI
import MessageUI

// MARK: - In-app Message & Mail Composers
//
// Lets a member text or email another member WITHOUT leaving the app to hunt for
// them in the Messages/Mail app — the compose sheet slides up pre-filled with the
// recipient and body; the user just taps Send. (iOS does not allow silently
// sending a message — the user always confirms — but this removes every other
// step.)
//
// Used by: People directory / MemberSheet (Text button), birthday actions
// ("Send wishes"), Family Fest dinner crew, help-request follow-ups.

// MARK: Message composer

struct MessageComposeView: UIViewControllerRepresentable {
    let recipients: [String]
    let body: String
    var onFinish: ((MessageComposeResult) -> Void)? = nil

    static var canSend: Bool { MFMessageComposeViewController.canSendText() }

    func makeUIViewController(context: Context) -> MFMessageComposeViewController {
        let vc = MFMessageComposeViewController()
        vc.recipients = recipients
        vc.body = body
        vc.messageComposeDelegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: MFMessageComposeViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    final class Coordinator: NSObject, MFMessageComposeViewControllerDelegate {
        let onFinish: ((MessageComposeResult) -> Void)?
        init(onFinish: ((MessageComposeResult) -> Void)?) { self.onFinish = onFinish }
        func messageComposeViewController(_ controller: MFMessageComposeViewController,
                                          didFinishWith result: MessageComposeResult) {
            controller.dismiss(animated: true)
            onFinish?(result)
        }
    }
}

// MARK: Mail composer

struct MailComposeView: UIViewControllerRepresentable {
    let recipients: [String]
    var subject: String = ""
    var body: String = ""
    var isHTML: Bool = false
    var onFinish: ((MFMailComposeResult) -> Void)? = nil

    static var canSend: Bool { MFMailComposeViewController.canSendMail() }

    func makeUIViewController(context: Context) -> MFMailComposeViewController {
        let vc = MFMailComposeViewController()
        vc.setToRecipients(recipients)
        vc.setSubject(subject)
        vc.setMessageBody(body, isHTML: isHTML)
        vc.mailComposeDelegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: MFMailComposeViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    final class Coordinator: NSObject, MFMailComposeViewControllerDelegate {
        let onFinish: ((MFMailComposeResult) -> Void)?
        init(onFinish: ((MFMailComposeResult) -> Void)?) { self.onFinish = onFinish }
        func mailComposeController(_ controller: MFMailComposeViewController,
                                   didFinishWith result: MFMailComposeResult,
                                   error: Error?) {
            controller.dismiss(animated: true)
            onFinish?(result)
        }
    }
}

// MARK: - Prefilled message helpers

enum MessageTemplates {
    static func birthday(firstName: String) -> String {
        "Happy birthday, \(firstName)! 🎂 Hope you have a great one — from the whole MLR family."
    }

    static func eventInvite(title: String, dateLabel: String) -> String {
        "You coming to \(title) on \(dateLabel)? RSVP in the MLR app 🌲"
    }

    static func onMyWay(what: String) -> String {
        "On my way to help with \"\(what)\" — see you in a few."
    }

    static func duesReminder(amount: String) -> String {
        "Friendly reminder: Family Fest dues (\(amount)) are due. You can send it right from the MLR app 🌲"
    }
}

// MARK: - Convenience presenter
//
// Drop `.messageComposer($composeState)` on any view and set the state to present.

struct MessageComposeState: Identifiable {
    let id = UUID()
    let recipients: [String]
    let body: String
}

extension View {
    func messageComposer(_ state: Binding<MessageComposeState?>) -> some View {
        sheet(item: state) { s in
            if MessageComposeView.canSend {
                MessageComposeView(recipients: s.recipients, body: s.body)
                    .ignoresSafeArea()
            } else {
                ContentUnavailableView("Can't send messages",
                                       systemImage: "message.badge.filled.fill",
                                       description: Text("This device isn't set up to send texts."))
            }
        }
    }
}
