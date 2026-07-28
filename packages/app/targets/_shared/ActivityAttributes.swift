import ActivityKit
import Foundation

/// Live Activity attributes.
///
/// Lives in `_shared` because both sides need it and they are separate
/// compilation units: the app target (via the native module) *starts* the
/// activity, and the widget extension *renders* it. Defining it twice would
/// compile but produce two distinct types, and `Activity.request` would never
/// match the widget's `ActivityConfiguration`.
struct AtlanticaActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Kept in state rather than the static attributes so the countdown can
        /// be corrected if the resort moves an event while the activity is live.
        var startsAt: Date
    }

    var title: String
    var venue: String
}
