import ActivityKit
import ExpoModulesCore
import WidgetKit

/// Bridges JS to the two things React Native cannot reach on its own: the
/// shared App Group container that feeds the widget, and ActivityKit.
///
/// Mirrors the `WidgetBridge` interface in `src/widget.ts`.
public class AtlanticaWidgetModule: Module {
    /// Live Activities are referenced by id from JS so they can be ended later.
    private static var activities: [String: Any] = [:]

    public func definition() -> ModuleDefinition {
        Name("AtlanticaWidget")

        /// Write a value into the shared container the widget reads from.
        AsyncFunction("setItem") { (key: String, value: String, appGroup: String) in
            guard let defaults = UserDefaults(suiteName: appGroup) else {
                throw NSError(
                    domain: "AtlanticaWidget",
                    code: 1,
                    userInfo: [
                        NSLocalizedDescriptionKey:
                            "App Group \(appGroup) is not available. Check the entitlement."
                    ]
                )
            }
            defaults.set(value, forKey: key)
        }

        /// Ask WidgetKit to rebuild timelines now rather than at its own pace.
        AsyncFunction("reloadAllTimelines") {
            if #available(iOS 14.0, *) {
                WidgetCenter.shared.reloadAllTimelines()
            }
        }

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
                let startsAtRaw = json["startsAt"] as? String
            else { return nil }

            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var startsAt = formatter.date(from: startsAtRaw)
            if startsAt == nil {
                formatter.formatOptions = [.withInternetDateTime]
                startsAt = formatter.date(from: startsAtRaw)
            }
            guard let start = startsAt else { return nil }

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
}
