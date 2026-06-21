import SwiftUI

// MARK: - Typography
// Yellowtail (script/wordmark) and Cinzel (Family Fest serif) must be added
// to the Xcode project: drag the .ttf files into the bundle and declare them
// in Info.plist under "Fonts provided by application".

extension Font {
    // Resort script wordmark (Yellowtail)
    static func script(_ size: CGFloat) -> Font {
        .custom("Yellowtail-Regular", size: size)
    }

    // Family Fest serif (Cinzel)
    static func festSerif(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        switch weight {
        case .bold, .heavy, .black:
            return .custom("Cinzel-Bold", size: size)
        default:
            return .custom("Cinzel-Regular", size: size)
        }
    }

    // System scale aliases (respect Dynamic Type via scaled variants)
    static let mlrTitle    = Font.system(.title,    design: .rounded, weight: .bold)
    static let mlrHeadline = Font.system(.headline, design: .rounded, weight: .semibold)
    static let mlrBody     = Font.system(.body)
    static let mlrCaption  = Font.system(.caption)
    static let mlrFootnote = Font.system(.footnote)
}

// MARK: - Text style modifiers

extension Text {
    func scriptStyle(size: CGFloat = 28) -> Text {
        self.font(.script(size)).foregroundStyle(Color.mlrPrimary)
    }

    func festSerifStyle(size: CGFloat = 22, weight: Font.Weight = .regular) -> Text {
        self.font(.festSerif(size, weight: weight))
    }
}

// MARK: - Section label

struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.mlrTextMuted)
            .tracking(0.8)
    }
}
