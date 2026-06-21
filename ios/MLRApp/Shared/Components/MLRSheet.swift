import SwiftUI

// MARK: - MLRSheet
// Reusable bottom sheet wrapper.
// Mirrors the web app's components/Sheet.tsx pattern:
// grab handle + close button + safe-area footer.
// Usage:
//   .mlrSheet(isPresented: $showSheet) { MyContent() }
//
// Or present as a SwiftUI .sheet with the MLRSheetContainer wrapper inside.

// MARK: - Sheet container

/// Wrap your sheet content in this view when presenting via `.sheet(isPresented:)`.
/// Provides the standard MLR grab handle, close button, and safe-area padding.
struct MLRSheetContainer<Content: View>: View {
    @Environment(\.dismiss) private var dismiss
    let title: String?
    @ViewBuilder let content: Content

    init(title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            // Grab handle
            Capsule()
                .fill(Color.mlrBorder)
                .frame(width: 36, height: 4)
                .padding(.top, 12)
                .padding(.bottom, title != nil ? 8 : 4)

            // Optional title row with close button
            if let title {
                HStack {
                    Text(title)
                        .font(.mlrHeadline)
                        .foregroundStyle(Color.mlrText)
                    Spacer()
                    CloseButton { dismiss() }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 12)
            } else {
                HStack {
                    Spacer()
                    CloseButton { dismiss() }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 4)
            }

            Divider()
                .foregroundStyle(Color.mlrBorder)

            // Sheet content — caller is responsible for internal scroll if needed
            content
                .padding(.bottom, 20) // safe area top-up; .safeAreaInset adds more below
        }
        .background(Color.mlrSurface)
        // Extra safe area padding at the bottom for home-indicator devices
        .safeAreaInset(edge: .bottom) { Color.clear.frame(height: 8) }
    }
}

// MARK: - View modifier convenience

extension View {
    /// Present an MLR-styled bottom sheet.
    func mlrSheet<Content: View>(
        isPresented: Binding<Bool>,
        title: String? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        self.sheet(isPresented: isPresented) {
            MLRSheetContainer(title: title, content: content)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.hidden) // we draw our own
        }
    }
}

// MARK: - Close button

/// Standard ✕ dismiss button used in sheets and overlays.
struct CloseButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.mlrTextMuted)
                .frame(width: 30, height: 30)
                .background(Color.mlrCard)
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - SectionLabel
// Uppercased, tracked, muted caption label for form sections.
// Already defined in Typography.swift; re-exported here for discovery
// by components that import this file. The struct is in Typography.swift
// to avoid duplication — nothing to add here.

// MARK: - FIELD input style

/// Apply to a `TextField` or `SecureField` to get the standard MLR input look.
///
///     TextField("Email", text: $email)
///         .fieldStyle()
struct FieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.mlrBody)
            .foregroundStyle(Color.mlrText)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color.mlrSurface)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.mlrBorder, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

extension View {
    /// Standard MLR text field border + padding style.
    /// Mirrors the web app's `FIELD` class from Sheet.tsx.
    func fieldStyle() -> some View {
        modifier(FieldStyle())
    }
}

// MARK: - Preview

#if DEBUG
struct MLRSheet_Previews: PreviewProvider {
    @State static var show = true

    static var previews: some View {
        Color.mlrSurface
            .mlrSheet(isPresented: $show, title: "Edit Profile") {
                VStack(alignment: .leading, spacing: 16) {
                    SectionLabel(text: "Basic info")
                    TextField("Your name", text: .constant(""))
                        .fieldStyle()
                    TextField("Phone", text: .constant(""))
                        .fieldStyle()
                    Spacer()
                    Button("Save") {}
                        .primaryButton()
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
            }
            .previewDisplayName("MLRSheet")
    }
}
#endif
