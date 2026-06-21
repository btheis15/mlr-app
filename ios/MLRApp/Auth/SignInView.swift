import SwiftUI

// MARK: - SignInView
// Two-step passwordless sign-in: email entry → 6-digit OTP code entry.

struct SignInView: View {
    @Environment(AppEnvironment.self) private var env
    /// Called when sign-in completes successfully.
    var onSignedIn: () -> Void = {}

    @State private var step: Step = .email
    @State private var email: String = ""
    @State private var code: String = ""

    // Resend cooldown
    @State private var resendSecondsLeft: Int = 0
    @State private var resendTimer: Timer? = nil

    @FocusState private var emailFocused: Bool
    @FocusState private var codeFocused: Bool

    private var auth: AuthService { env.authService }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Reassurance header
                reassuranceHeader

                Spacer().frame(height: 32)

                switch step {
                case .email:
                    emailStep
                case .code:
                    codeStep
                }

                Spacer()

                helpLink
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .navigationTitle("Sign In")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: auth.isSignedIn) { _, signedIn in
                if signedIn { onSignedIn() }
            }
        }
    }

    // MARK: - Reassurance header

    private var reassuranceHeader: some View {
        VStack(spacing: 6) {
            Image("brand-logo-green")
                .resizable()
                .scaledToFit()
                .frame(height: 56)

            Text("Just your name & email — no password.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: - Step 1: Email

    private var emailStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Enter your email")
                    .font(.title2.bold())
                Text("We'll send you a one-time sign-in code.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            TextField("you@example.com", text: $email)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.emailAddress)
                .submitLabel(.go)
                .focused($emailFocused)
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .onSubmit { Task { await sendCode() } }
                .onAppear { emailFocused = true }

            if let error = auth.error {
                errorBanner(error)
            }

            primaryButton(
                label: "Send Code",
                isLoading: auth.isLoading,
                isDisabled: email.trimmingCharacters(in: .whitespaces).isEmpty
            ) {
                Task { await sendCode() }
            }
        }
    }

    // MARK: - Step 2: OTP code

    private var codeStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Enter your code")
                    .font(.title2.bold())
                Text("We sent a 6-digit code to **\(email)**.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("Check your spam folder if you don't see it.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            TextField("000000", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.system(size: 32, weight: .semibold, design: .monospaced))
                .multilineTextAlignment(.center)
                .focused($codeFocused)
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .onChange(of: code) { _, newValue in
                    // Strip non-digits and cap at 6
                    let digits = newValue.filter(\.isNumber)
                    if digits.count > 6 {
                        code = String(digits.prefix(6))
                    } else {
                        code = digits
                    }
                    // Auto-submit when 6 digits entered
                    if code.count == 6 {
                        Task { await verifyCode() }
                    }
                }
                .onAppear { codeFocused = true }

            if let error = auth.error {
                errorBanner(error)
            }

            primaryButton(
                label: "Verify Code",
                isLoading: auth.isLoading,
                isDisabled: code.count < 6
            ) {
                Task { await verifyCode() }
            }

            // Resend row
            HStack {
                Text("Didn't get it?")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                if resendSecondsLeft > 0 {
                    Text("Resend in \(resendSecondsLeft)s")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    Button("Resend code") {
                        Task { await resend() }
                    }
                    .font(.subheadline.bold())
                    .foregroundStyle(Color("primary"))
                    .disabled(auth.isLoading)
                }
            }

            // Back
            Button("← Use a different email") {
                cancelToEmailStep()
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
    }

    // MARK: - Help link

    private var helpLink: some View {
        NavigationLink {
            HelpView()
        } label: {
            Text("Need help signing in?")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .underline()
        }
        .padding(.bottom, 24)
    }

    // MARK: - Reusable sub-views

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(.red)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .background(Color.red.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func primaryButton(
        label: String,
        isLoading: Bool,
        isDisabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Group {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                } else {
                    Text(label)
                        .font(.body.bold())
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
        }
        .background(isDisabled ? Color(.systemGray4) : Color("primary"))
        .foregroundStyle(.white)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .disabled(isDisabled || isLoading)
    }

    // MARK: - Actions

    private func sendCode() async {
        let trimmed = email.trimmingCharacters(in: .whitespaces).lowercased()
        guard !trimmed.isEmpty else { return }
        email = trimmed
        await auth.sendOTP(email: trimmed)
        if auth.error == nil {
            step = .code
            startResendCooldown()
        }
    }

    private func verifyCode() async {
        await auth.verifyOTP(email: email, token: code)
        // onChange(of: auth.isSignedIn) handles navigation on success
    }

    private func resend() async {
        await auth.sendOTP(email: email)
        if auth.error == nil {
            code = ""
            startResendCooldown()
        }
    }

    private func cancelToEmailStep() {
        step = .email
        code = ""
        auth.error = nil
        stopResendTimer()
    }

    // MARK: - Resend cooldown

    private func startResendCooldown() {
        stopResendTimer()
        resendSecondsLeft = 30
        resendTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            Task { @MainActor in
                if resendSecondsLeft > 0 {
                    resendSecondsLeft -= 1
                } else {
                    stopResendTimer()
                }
            }
        }
    }

    private func stopResendTimer() {
        resendTimer?.invalidate()
        resendTimer = nil
        resendSecondsLeft = 0
    }

    // MARK: - Step enum

    private enum Step {
        case email, code
    }
}

// MARK: - HelpView placeholder
// Replace with the real Help screen once it is extracted into its own file.

private struct HelpView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Signing in uses a one-time code sent to your email — no password needed.")
                Text("**Didn't get the code?**\nCheck your Spam or Junk folder. The code is valid for 10 minutes.")
                Text("**Wrong email?**\nGo back and re-enter your address.")
                Text("**Still stuck?**")
                Link("Text or email for help", destination: URL(string: "sms:+1XXXXXXXXXX")!)
            }
            .padding()
        }
        .navigationTitle("Help")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    SignInView()
        .environment(AppEnvironment())
}
