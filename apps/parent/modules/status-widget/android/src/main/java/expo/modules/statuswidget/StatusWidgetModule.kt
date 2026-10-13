package expo.modules.statuswidget

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Lets the app push the children's statuses to the home-screen widget. */
class StatusWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StatusWidget")

    // `json` is an array of { name, label, color, at }; null clears the widget (sign-out).
    Function("setChildren") { json: String? ->
      appContext.reactContext?.let { StatusWidgetProvider.save(it, json) }
    }
  }
}
