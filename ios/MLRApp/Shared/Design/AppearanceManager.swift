import SwiftUI

// MARK: - Appearance Manager
//
// The app follows the system light/dark appearance by default, with an optional
// per-device override (System / Light / Dark) surfaced in Profile → Appearance.
// Persisted in UserDefaults.

enum AppAppearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "System"
        case .light:  return "Light"
        case .dark:   return "Dark"
        }
    }

    var symbol: String {
        switch self {
        case .system: return "circle.lefthalf.filled"
        case .light:  return "sun.max.fill"
        case .dark:   return "moon.fill"
        }
    }

    /// nil = follow the system (no forced scheme).
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light:  return .light
        case .dark:   return .dark
        }
    }
}

@Observable
final class AppearanceManager {
    static let shared = AppearanceManager()

    private let key = "app_appearance"

    var appearance: AppAppearance {
        didSet { UserDefaults.standard.set(appearance.rawValue, forKey: key) }
    }

    private init() {
        let raw = UserDefaults.standard.string(forKey: key)
        appearance = raw.flatMap(AppAppearance.init) ?? .system
    }
}
