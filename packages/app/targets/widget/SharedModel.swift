import Foundation

/// The contract between the React Native app and the widget extension.
///
/// The app writes JSON into the shared App Group container; the widget reads
/// it. Field names must match `WidgetPayload` in `src/widget.ts` exactly --
/// they are two halves of one wire format, and there is no compiler checking
/// across that boundary.
struct ScheduleEvent: Codable, Identifiable {
    let title: String
    /// ISO-8601 with offset, e.g. "2026-07-31T21:00:00.000+03:00".
    let startsAt: String
    /// Wall-clock time at the resort, pre-formatted so the widget never has to
    /// reason about timezones.
    let startTime: String
    let venue: String?
    let category: String

    var id: String { "\(startsAt)-\(title)" }

    var startDate: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = formatter.date(from: startsAt) { return d }
        // The server emits fractional seconds, but be forgiving in case that
        // ever changes -- a widget that silently shows nothing is a bad failure.
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: startsAt)
    }

    var isEntertainment: Bool { category == "entertainment" }
}

struct SchedulePayload: Codable {
    let updatedAt: String
    let events: [ScheduleEvent]
}

enum SharedStore {
    /// Must match `APP_GROUP` in `packages/app/identifiers.js`. Swift cannot
    /// read that file, so this is the one copy that has to be kept in step by
    /// hand -- a mismatch does not fail the build, the widget just renders
    /// nothing.
    static let appGroup = "group.com.alexivanov.atlantica"
    static let key = "upcoming"

    /// Reads the payload the app last wrote. Returns an empty list rather than
    /// nil on any failure, so the widget degrades to "Nothing scheduled"
    /// instead of showing a placeholder forever.
    static func load() -> SchedulePayload {
        guard
            let defaults = UserDefaults(suiteName: appGroup),
            let raw = defaults.string(forKey: key),
            let data = raw.data(using: .utf8),
            let decoded = try? JSONDecoder().decode(SchedulePayload.self, from: data)
        else {
            return SchedulePayload(updatedAt: "", events: [])
        }
        return decoded
    }
}
