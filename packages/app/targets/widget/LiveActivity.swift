import ActivityKit
import SwiftUI
import WidgetKit

/// Live Activity: a countdown on the lock screen and in the Dynamic Island as
/// an event approaches.
///
/// `AtlanticaActivityAttributes` is defined in `targets/_shared` so this
/// extension and the app's native module compile against the same type.

@available(iOS 16.2, *)
struct AtlanticaLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AtlanticaActivityAttributes.self) { context in
            // Lock screen / banner presentation.
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(hex: 0xF2B880))
                    .frame(width: 3, height: 34)

                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.title)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(1)
                    if !context.attributes.venue.isEmpty {
                        Text(context.attributes.venue)
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                // `.timer` style lets the system tick the countdown without the
                // app running, which is the entire point of a Live Activity.
                Text(context.state.startsAt, style: .timer)
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .frame(width: 78)
            }
            .padding(14)
            .activityBackgroundTint(Color(hex: 0x12152E))
            .activitySystemActionForegroundColor(Color(hex: 0xF2B880))

        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.title)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.startsAt, style: .timer)
                        .font(.system(size: 15, weight: .semibold))
                        .monospacedDigit()
                        .frame(width: 62)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !context.attributes.venue.isEmpty {
                        Text(context.attributes.venue)
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                    }
                }
            } compactLeading: {
                Circle()
                    .fill(Color(hex: 0xF2B880))
                    .frame(width: 8, height: 8)
            } compactTrailing: {
                Text(context.state.startsAt, style: .timer)
                    .monospacedDigit()
                    .font(.system(size: 13))
                    .frame(width: 44)
            } minimal: {
                Circle()
                    .fill(Color(hex: 0xF2B880))
                    .frame(width: 8, height: 8)
            }
            .keylineTint(Color(hex: 0xF2B880))
        }
    }
}
