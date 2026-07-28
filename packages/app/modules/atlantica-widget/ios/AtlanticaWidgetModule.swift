import ActivityKit
import ExpoModulesCore

/// Live Activity bridge.
///
/// Deliberately narrow: writing to the shared App Group container and reloading
/// widget timelines are already provided by @bacons/apple-targets'
/// `ExtensionStorage`, so this module only covers what that does not --
/// ActivityKit.
public class AtlanticaWidgetModule: Module {
    /// Activities are referenced by id from JS so they can be ended later.
    /// `Any` because `Activity<T>` is only available from iOS 16.2 and stored
    /// properties cannot carry an availability annotation.
    private static var activities: [String: Any] = [:]

    public func definition() -> ModuleDefinition {
        Name("AtlanticaWidget")

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
                let activity = try Activity.request(
                    attributes: attributes,
                    content: .init(state: state, staleDate: start.addingTimeInterval(3600)),
                    pushType: nil
                )
                Self.activities[activity.id] = activity
                return activity.id
            } catch {
                return nil
            }
        }

        AsyncFunction("endLiveActivity") { (id: String) in
            guard #available(iOS 16.2, *) else { return }
            guard let activity = Self.activities[id] as? Activity<AtlanticaActivityAttributes>
            else { return }
            Task {
                await activity.end(nil, dismissalPolicy: .immediate)
                Self.activities.removeValue(forKey: id)
            }
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
