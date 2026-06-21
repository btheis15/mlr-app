import WidgetKit
import SwiftUI

// MARK: - Widget Bundle (extension entry point)
//
// This is a SEPARATE Xcode target: a Widget Extension. In Xcode:
//   File → New → Target → Widget Extension, check "Include Live Activity".
//   Name it "MLRWidget". Add it to the App Group (group.com.muskellungelakeresort.mlr)
//   so it can read shared data (fest dates, next event) from the app.
//
// Files in this folder belong to the MLRWidget target. The shared files
// (FestActivityAttributes.swift, FestSeason.swift, SeedData.swift, Colors.swift)
// must have BOTH the app and MLRWidget targets checked in the File Inspector.

@main
struct MLRWidgetBundle: WidgetBundle {
    var body: some Widget {
        FamilyFestCountdownWidget()
        NextEventWidget()
        FestLiveActivity()
    }
}
