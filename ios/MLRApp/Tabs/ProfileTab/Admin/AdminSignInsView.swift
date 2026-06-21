import SwiftUI

// MARK: - GeoLocation
// Client-side IP geolocation using ip-api.com (free, no key needed at low volume).

struct GeoLocation: Equatable {
    let city: String
    let regionName: String
    let country: String

    var display: String {
        if city.isEmpty && regionName.isEmpty { return country }
        if city.isEmpty { return "\(regionName), \(country)" }
        return "\(city), \(regionName)"
    }
}

private actor GeoCache {
    static let shared = GeoCache()
    private var cache: [String: GeoLocation] = [:]

    func get(_ ip: String) -> GeoLocation? { cache[ip] }
    func set(_ ip: String, _ loc: GeoLocation) { cache[ip] = loc }
}

@MainActor
private func geolocateIP(_ ip: String) async -> GeoLocation? {
    // Skip private/loopback ranges
    if ip.hasPrefix("127.") || ip.hasPrefix("::1") || ip.hasPrefix("10.")
        || ip.hasPrefix("192.168.") || ip.isEmpty { return nil }

    if let cached = await GeoCache.shared.get(ip) { return cached }

    guard let url = URL(string: "http://ip-api.com/json/\(ip)?fields=city,regionName,country,status") else {
        return nil
    }

    do {
        let (data, _) = try await URLSession.shared.data(from: url)
        if let json = try? JSONDecoder().decode(IPAPIResponse.self, from: data),
           json.status == "success" {
            let loc = GeoLocation(city: json.city ?? "", regionName: json.regionName ?? "", country: json.country ?? "")
            await GeoCache.shared.set(ip, loc)
            return loc
        }
    } catch {
        // Non-fatal
    }
    return nil
}

private struct IPAPIResponse: Codable {
    let status: String
    let city: String?
    let regionName: String?
    let country: String?
}

// MARK: - SignInRow model (combines SignInEntry + geolocation)

private struct SignInRow: Identifiable {
    let entry: SignInEntry
    var geo: GeoLocation? = nil

    var id: UUID { entry.id }
}

// MARK: - AdminSignInsView

struct AdminSignInsView: View {
    @Environment(AppEnvironment.self) private var env

    @State private var rows: [SignInRow] = []
    @State private var isLoading = false
    @State private var error: String? = nil

    // MARK: - Body

    var body: some View {
        List {
            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(Color.mlrDanger)
                        .font(.subheadline)
                }
            }

            if isLoading && rows.isEmpty {
                ForEach(0..<8, id: \.self) { _ in
                    signinSkeleton
                }
            } else if !isLoading && rows.isEmpty && error == nil {
                emptyState
            } else {
                ForEach(rows) { row in
                    SignInEntryRow(row: row)
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Recent Sign-Ins")
        .navigationBarTitleDisplayMode(.large)
        .refreshable {
            await loadSignIns()
        }
        .task {
            await loadSignIns()
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        Section {
            VStack(spacing: 16) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(Color.mlrTextSubtle)
                Text("No sign-ins yet")
                    .font(.headline)
                    .foregroundStyle(Color.mlrTextMuted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 48)
            .listRowBackground(Color.clear)
        }
    }

    // MARK: - Skeleton

    private var signinSkeleton: some View {
        HStack(spacing: 12) {
            Circle().fill(Color.mlrCard).frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 4).fill(Color.mlrCard).frame(height: 13).frame(maxWidth: 140)
                RoundedRectangle(cornerRadius: 4).fill(Color.mlrCard).frame(height: 11).frame(maxWidth: 200)
            }
        }
        .padding(.vertical, 6)
    }

    // MARK: - Data

    @MainActor
    private func loadSignIns() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let entries: [SignInEntry] = try await supabase
                .rpc("recent_signins")
                .execute()
                .value
            rows = entries.map { SignInRow(entry: $0) }
            // Geolocate IPs concurrently
            await geolocateAll()
        } catch {
            self.error = "Couldn't load sign-in log."
        }
    }

    @MainActor
    private func geolocateAll() async {
        await withTaskGroup(of: (Int, GeoLocation?).self) { group in
            for (idx, row) in rows.enumerated() {
                guard let ip = row.entry.ipAddress, !ip.isEmpty else { continue }
                group.addTask {
                    let geo = await geolocateIP(ip)
                    return (idx, geo)
                }
            }
            for await (idx, geo) in group {
                rows[idx].geo = geo
            }
        }
    }
}

// MARK: - SignInEntryRow

private struct SignInEntryRow: View {
    let row: SignInRow

    private var entry: SignInEntry { row.entry }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Avatar initials circle
            Circle()
                .fill(Color.mlrPrimaryLight)
                .frame(width: 36, height: 36)
                .overlay {
                    Text(entry.email.prefix(1).uppercased())
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.mlrPrimary)
                }

            VStack(alignment: .leading, spacing: 3) {
                Text(entry.email)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.mlrText)
                    .lineLimit(1)
                    .truncationMode(.middle)

                // Timestamp
                Text(MLRFormat.relativeTime(entry.createdAt))
                    .font(.caption)
                    .foregroundStyle(Color.mlrTextMuted)

                // IP + geo
                if let ip = entry.ipAddress, !ip.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "network")
                            .font(.system(size: 10))
                        if let geo = row.geo {
                            Text("\(ip) · \(geo.display)")
                        } else {
                            Text(ip)
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(Color.mlrTextSubtle)
                }
            }

            Spacer()
        }
        .padding(.vertical, 6)
    }
}

#Preview {
    NavigationStack {
        AdminSignInsView()
    }
    .environment(AppEnvironment())
}
