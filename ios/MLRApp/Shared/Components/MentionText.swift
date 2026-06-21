import SwiftUI

// MARK: - MentionText
// Renders a string with @name mentions highlighted in mlrPrimary green.
// Mirrors the web app's shared `MentionText` helper and the @mention pattern
// in chat bubbles and post comments.
//
// Usage:
//   MentionText("Hey @Dorothy, can you grab the paddles?")

// MARK: - MentionText view

struct MentionText: View {
    let text: String
    var baseFont: Font = .mlrBody
    var baseColor: Color = Color.mlrText
    var mentionColor: Color = Color.mlrPrimary

    var body: some View {
        Text(attributedString)
            .font(baseFont)
    }

    private var attributedString: AttributedString {
        var result = AttributedString()
        let segments = Self.parse(text)

        for segment in segments {
            switch segment {
            case .plain(let s):
                var part = AttributedString(s)
                part.foregroundColor = UIColor(baseColor)
                result.append(part)

            case .mention(let s):
                var part = AttributedString(s)
                part.foregroundColor = UIColor(mentionColor)
                // Semi-bold weight for mentions
                part.font = UIFont.systemFont(
                    ofSize: UIFont.preferredFont(forTextStyle: .body).pointSize,
                    weight: .semibold
                )
                result.append(part)
            }
        }
        return result
    }
}

// MARK: - Text segment parser

private enum TextSegment {
    case plain(String)
    case mention(String) // includes the leading @
}

extension MentionText {
    /// Splits `text` into alternating plain / mention segments.
    /// A mention is `@` followed by one or more non-whitespace characters.
    static func parse(_ text: String) -> [TextSegment] {
        var segments: [TextSegment] = []
        // Match @word (word = alphanumeric + underscore, matching web app convention)
        let pattern = try! NSRegularExpression(pattern: #"@[\w]+"#)
        let nsText = text as NSString
        var cursor = text.startIndex

        let matches = pattern.matches(in: text, range: NSRange(text.startIndex..., in: text))

        for match in matches {
            guard let range = Range(match.range, in: text) else { continue }

            // Plain text before this mention
            if cursor < range.lowerBound {
                segments.append(.plain(String(text[cursor..<range.lowerBound])))
            }

            // The mention itself
            segments.append(.mention(String(text[range])))

            cursor = range.upperBound
        }

        // Remaining plain text after the last mention
        if cursor < text.endIndex {
            segments.append(.plain(String(text[cursor...])))
        }

        return segments.isEmpty ? [.plain(text)] : segments
    }
}

// MARK: - MentionAutocomplete

/// A small overlay list that appears above the keyboard when the user types `@`
/// in a TextEditor. Filters the member list and lets the user tap to complete.
///
/// Usage in a view that has a TextEditor:
///
///   @State private var messageText = ""
///   @State private var mentionQuery: String? = nil   // nil = hidden
///
///   ZStack(alignment: .bottomLeading) {
///       TextEditor(text: $messageText)
///           .onChange(of: messageText) { _, new in
///               mentionQuery = detectMentionQuery(in: new)
///           }
///
///       if let query = mentionQuery {
///           MentionAutocomplete(
///               members: allMembers,
///               query: query,
///               onSelect: { profile in
///                   messageText = applyMention(profile, to: messageText)
///                   mentionQuery = nil
///               }
///           )
///       }
///   }

struct MentionAutocomplete: View {
    let members: [Profile]
    var query: String = ""
    var onSelect: (Profile) -> Void = { _ in }

    private var filtered: [Profile] {
        let q = query.lowercased()
        guard !q.isEmpty else { return Array(members.prefix(6)) }
        return members
            .filter { $0.name.lowercased().contains(q) }
            .prefix(6)
            .map { $0 }
    }

    var body: some View {
        if !filtered.isEmpty {
            VStack(spacing: 0) {
                ForEach(filtered) { profile in
                    Button {
                        onSelect(profile)
                    } label: {
                        HStack(spacing: 10) {
                            AvatarView(profile: profile, size: .small)

                            Text(profile.name)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Color.mlrText)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    if profile.id != filtered.last?.id {
                        Divider()
                            .padding(.leading, 50)
                    }
                }
            }
            .background(Color.mlrSurface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.mlrBorder, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.08), radius: 8, x: 0, y: -4)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}

// MARK: - Mention detection helpers

/// Returns the current @query if the cursor is inside a mention, else nil.
/// Call from `.onChange(of: text)`.
func detectMentionQuery(in text: String) -> String? {
    // Find the last @ not followed by whitespace
    guard let atIndex = text.lastIndex(of: "@") else { return nil }
    let afterAt = text[text.index(after: atIndex)...]
    // Only active if the text after @ has no space (still typing the name)
    if afterAt.contains(" ") || afterAt.contains("\n") { return nil }
    return String(afterAt)
}

/// Replaces the trailing @query in `text` with `@fullName `.
func applyMention(_ profile: Profile, to text: String) -> String {
    guard let atIndex = text.lastIndex(of: "@") else { return text }
    let prefix = String(text[..<atIndex])
    return prefix + "@\(profile.name) "
}

// MARK: - Preview

#if DEBUG
struct MentionText_Previews: PreviewProvider {
    static let sampleMembers = [
        Profile.guest,
    ]

    static var previews: some View {
        VStack(alignment: .leading, spacing: 20) {
            SectionLabel(text: "MentionText")

            MentionText("Hey @Dorothy, can you grab the paddles?")

            MentionText(
                "Great idea @Leo! @Dorothy and I will handle the fish fry.",
                baseFont: .system(size: 15)
            )

            MentionText("No mentions in this string — plain text only.")

            Divider()

            SectionLabel(text: "MentionAutocomplete")
            MentionAutocomplete(
                members: [Profile.guest],
                query: "le",
                onSelect: { _ in }
            )
            .padding(.horizontal)
        }
        .padding(20)
        .previewDisplayName("MentionText")
    }
}
#endif
