import ActivityKit
import ExpoModulesCore

/// Live Activity bridge.
///
/// Deliberately narrow: writing to the shared App Group container and reloading
/// widget timelines are already provided by @bacons/apple-targets'
/// `ExtensionStorage`, so this module only covers what that does not --
/// ActivityKit.
public class AtlanticaLiveActivityModule: Module {
    /// Activities are referenced by id from JS so they can be ended later.
    /// `Any` because `Activity<T>` is only available from iOS 16.2 and stored
    /// properties cannot carry an availability annotation.
    private static var activities: [String: Any] = [:]

    public func definition() -> ModuleDefinition {
        Name("AtlanticaLiveActivity")

        AsyncFunction("areLiveActivitiesEnabled") { () -> Bool in
            if #available(iOS 16.2, *) {
                return ActivityAuthorizationInfo().areActivitiesEnabled
            }
            return false
        }

        /// Start a countdown for one event. Returns an id, or nil when Live
        /// Activities are unavailable (older iOS, or the user disabled them).
        AsyncFunction("startLiveActivity") { (payload: String) -> String? in
            guard #available(iOS 16.2, *) else { return nil }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }

            guard
                let data = payload.data(using: .utf8),
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let title = json["title"] as? String,
                let startsAtRaw = json["startsAt"] as? String,
                let start = Self.parseISO(startsAtRaw)
            else { return nil }

            let attributes = AtlanticaActivityAttributes(
                title: title,
                venue: (json["venue"] as? String) ?? ""
            )
            let state = AtlanticaActivityAttributes.ContentState(startsAt: start)

            do {
                // staleDate is the event start: past it the widget switches to
                // "Now" instead of counting upward forever.
                let activity = try Activity.request(
                    attributes: attributes,
                    content: .init(state: state, staleDate: start),
                    pushType: nil
                )
                Self.activities[activity.id] = activity

                // Auto-remove at event start. Only the system can dismiss a Live
                // Activity while the app is not running, and `.after(date)` is
                // the one mechanism for it -- otherwise a finished event's
                // countdown sits on the Lock Screen until the app is next opened.
                //
                // ActivityKit caps this at 4 hours from the call, so for events
                // further out we leave it alone and let the app clear it on next
                // foreground; dismissing early would be worse than lingering.
                let untilStart = start.timeIntervalSinceNow
                if untilStart > 0, untilStart < 4 * 3600 {
                    Task {
                        await activity.end(
                            .init(state: state, staleDate: start),
                            dismissalPolicy: .after(start)
                        )
                    }
                }
                return activity.id
            } catch {
                return nil
            }
        }

        /// Ids of activities the system currently considers running.
        ///
        /// Read from ActivityKit rather than the in-process dictionary, which
        /// does not survive an app restart. Without this, JS has no way to know
        /// a countdown from a previous launch is still on screen.
        AsyncFunction("activeActivityIds") { () -> [String] in
            guard #available(iOS 16.2, *) else { return [] }
            return Activity<AtlanticaActivityAttributes>.activities.map { $0.id }
        }

        AsyncFunction("endLiveActivity") { (id: String) in
            guard #available(iOS 16.2, *) else { return }
            // Look the activity up from ActivityKit, not the static dictionary:
            // that dictionary is empty after a process restart, so ending a
            // countdown started in a previous launch silently did nothing and
            // left it stuck on the Lock Screen with no way to dismiss it.
            let running = Activity<AtlanticaActivityAttributes>.activities
            guard let activity = running.first(where: { $0.id == id }) else { return }
            await activity.end(nil, dismissalPolicy: .immediate)
            Self.activities.removeValue(forKey: id)
        }

        /// Escape hatch: clears every countdown regardless of who started it.
        AsyncFunction("endAllLiveActivities") {
            guard #available(iOS 16.2, *) else { return }
            for activity in Activity<AtlanticaActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            Self.activities.removeAll()
        }
    }

    /// The server emits fractional seconds, but stay forgiving in case that
    /// changes -- a Live Activity that silently never starts is hard to debug.
    private static func parseISO(_ raw: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = formatter.date(from: raw) { return d }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)
    }
}
