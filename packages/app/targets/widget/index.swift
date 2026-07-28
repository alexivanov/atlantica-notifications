import SwiftUI
import WidgetKit

/// Bundle entry point. Both the home screen widget and the Live Activity are
/// WidgetKit targets and ship in the same extension.
@main
struct AtlanticaWidgetBundle: WidgetBundle {
    var body: some Widget {
        AtlanticaWidget()
        if #available(iOS 16.2, *) {
            AtlanticaLiveActivity()
        }
    }
}
