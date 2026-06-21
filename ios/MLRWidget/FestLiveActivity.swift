import ActivityKit
import WidgetKit
import SwiftUI

// MARK: - Family Fest Live Activity UI
//
// Lives in the widget extension. Renders the Lock Screen banner + Dynamic Island
// presentations. The app drives the content via `FestLiveActivityController`.
// iOS 26: Live Activity surfaces inherit Liquid Glass automatically; we provide
// the content layout and let the system supply the material.

struct FestLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FestActivityAttributes.self) { context in
            // MARK: Lock Screen / banner presentation
            LockScreenFestView(context: context)
                .activityBackgroundTint(Color.mlrFest.opacity(0.12))
                .activitySystemActionForegroundColor(Color.mlrFest)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.emoji + " Fest")
                            .font(.caption2.bold())
                            .foregroundStyle(.secondary)
                        Text(context.state.phaseLabel)
                            .font(.headline)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("Next")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(context.state.nextEventTime)
                            .font(.headline)
                            .monospacedDigit()
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 6) {
                        Text(context.state.emoji)
                        VStack(alignment: .leading) {
                            Text(context.state.nextEventTitle)
                                .font(.subheadline.weight(.semibold))
                            if let loc = context.state.nextEventLocation {
                                Text(loc)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                    }
                }
            } compactLeading: {
                Text(context.state.emoji)
            } compactTrailing: {
                Text("D\(context.state.dayNumber)")
                    .font(.caption2.bold())
                    .foregroundStyle(Color.mlrFest)
            } minimal: {
                Text(context.state.emoji)
            }
            .widgetURL(URL(string: "mlr://family-fest"))
            .keylineTint(Color.mlrFest)
        }
    }
}

// MARK: - Lock Screen view

private struct LockScreenFestView: View {
    let context: ActivityViewContext<FestActivityAttributes>

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("🌲 Family Fest \(String(context.attributes.festYear))")
                        .font(.caption.bold())
                        .foregroundStyle(Color.mlrFest)
                    PulsingLiveDot(color: .mlrFest)
                }
                Text(context.state.phaseLabel)
                    .font(.title3.bold())
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("Up next")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text("\(context.state.emoji) \(context.state.nextEventTitle)")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(context.state.nextEventTime)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
        .padding()
    }
}
