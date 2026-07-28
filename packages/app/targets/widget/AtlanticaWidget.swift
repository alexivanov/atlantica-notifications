import SwiftUI
import WidgetKit

/// Home screen widget: what is on next, without opening the app.

struct ScheduleEntry: TimelineEntry {
    let date: Date
    let events: [ScheduleEvent]
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> ScheduleEntry {
        ScheduleEntry(
            date: Date(),
            events: [
                ScheduleEvent(
                    title: "DJ Set",
                    startsAt: "",
                    startTime: "21:00",
                    venue: "Sky Bar",
                    category: "entertainment"
                )
            ]
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (ScheduleEntry) -> Void) {
        completion(ScheduleEntry(date: Date(), events: SharedStore.load().events))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ScheduleEntry>) -> Void) {
        let now = Date()
        let events = SharedStore.load().events

        // Refresh when the next event starts, so a finished event drops off the
        // widget without waiting for the app to be opened. Falls back to an
        // hourly refresh when nothing is scheduled.
        let nextBoundary = events
            .compactMap(\.startDate)
            .filter { $0 > now }
            .min() ?? now.addingTimeInterval(3600)

        let entry = ScheduleEntry(date: now, events: events.filter {
            guard let start = $0.startDate else { return true }
            return start > now
        })

        completion(Timeline(entries: [entry], policy: .after(nextBoundary)))
    }
}

struct AtlanticaWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    var entry: ScheduleEntry

    private var visibleCount: Int {
        switch family {
        case .systemSmall: return 1
        case .systemMedium: return 3
        default: return 5
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ATLANTICA")
                .font(.system(size: 10, weight: .bold))
                .kerning(1.2)
                .foregroundStyle(.secondary)

            if entry.events.isEmpty {
                Text("Nothing scheduled")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(entry.events.prefix(visibleCount)) { event in
                    HStack(alignment: .top, spacing: 8) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(event.isEntertainment ? Color(hex: 0xF2B880) : Color(hex: 0x7FD1C1))
                            .frame(width: 3)

                        VStack(alignment: .leading, spacing: 1) {
                            Text(event.title)
                                .font(.system(size: 13, weight: .semibold))
                                .lineLimit(1)
                            Text(
                                [event.startTime, event.venue]
                                    .compactMap { $0 }
                                    .joined(separator: " · ")
                            )
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .widgetBackground(Color(hex: 0x12152E))
    }
}

extension View {
    /// Widget backgrounds changed in iOS 17: `containerBackground(for: .widget)`
    /// is required there (without it the widget renders incorrectly in StandBy
    /// and on the Lock Screen), but it does not exist on iOS 16 -- and this
    /// target deploys to 16.2 because that is what ActivityKit needs.
    @ViewBuilder
    func widgetBackground(_ background: some View) -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(for: .widget) { background }
        } else {
            self.background(background)
        }
    }
}

struct AtlanticaWidget: Widget {
    let kind: String = "AtlanticaWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            AtlanticaWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Atlantica")
        .description("What's on at the resort next.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
