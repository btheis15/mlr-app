import Foundation

// MARK: - Date Formatters
// Port of lib/format.ts

enum MLRFormat {

    // MARK: Relative time ("2 hours ago", "just now")

    static func relativeTime(_ date: Date, from now: Date = .now) -> String {
        let seconds = Int(now.timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 7 { return "\(days)d ago" }
        return shortDate(date)
    }

    // MARK: Short date ("Aug 3")

    static func shortDate(_ date: Date) -> String {
        shortDateFormatter.string(from: date)
    }

    // MARK: Long date ("Sunday, August 3, 2026")

    static func longDate(_ date: Date) -> String {
        longDateFormatter.string(from: date)
    }

    // MARK: ISO date string → display ("Aug 3")

    static func shortDateISO(_ iso: String) -> String {
        guard let date = isoFormatter.date(from: iso) else { return iso }
        return shortDate(date)
    }

    // MARK: Date range ("Aug 2 – 8")

    static func dateRange(start: String, end: String?) -> String {
        guard let s = isoFormatter.date(from: start) else { return start }
        let startStr = shortDate(s)
        guard let endISO = end, let e = isoFormatter.date(from: endISO) else { return startStr }
        let cal = Calendar.current
        if cal.component(.month, from: s) == cal.component(.month, from: e) {
            let dayFmt = DateFormatter()
            dayFmt.dateFormat = "d"
            return "\(startStr) – \(dayFmt.string(from: e))"
        }
        return "\(startStr) – \(shortDate(e))"
    }

    // MARK: Currency ("$42.00")

    static func currency(_ amount: Double) -> String {
        currencyFormatter.string(from: NSNumber(value: amount)) ?? "$\(amount)"
    }

    // MARK: Phone number display ("(715) 555-1234")

    static func phone(_ raw: String) -> String {
        let digits = raw.filter(\.isNumber)
        guard digits.count == 10 else { return raw }
        let area = digits.prefix(3)
        let prefix = digits.dropFirst(3).prefix(3)
        let line = digits.suffix(4)
        return "(\(area)) \(prefix)-\(line)"
    }

    // MARK: Ordinal ("3rd")

    static func ordinal(_ n: Int) -> String {
        let suffix: String
        switch n % 100 {
        case 11, 12, 13: suffix = "th"
        default:
            switch n % 10 {
            case 1: suffix = "st"
            case 2: suffix = "nd"
            case 3: suffix = "rd"
            default: suffix = "th"
            }
        }
        return "\(n)\(suffix)"
    }

    // MARK: Countdown ("3 days", "Tomorrow", "Today")

    static func countdown(days: Int) -> String {
        switch days {
        case 0:  return "Today"
        case 1:  return "Tomorrow"
        default: return "\(days) days"
        }
    }
}

// MARK: - Private formatters

private let shortDateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "MMM d"
    f.timeZone = TimeZone(identifier: "America/Chicago")
    return f
}()

private let longDateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateStyle = .full
    f.timeZone = TimeZone(identifier: "America/Chicago")
    return f
}()

private let isoFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone(identifier: "America/Chicago")
    f.locale = Locale(identifier: "en_US_POSIX")
    return f
}()

private let currencyFormatter: NumberFormatter = {
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.currencyCode = "USD"
    return f
}()

// MARK: - Date extension helpers

extension Date {
    var isoDateString: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "America/Chicago")
        return f.string(from: self)
    }
}
