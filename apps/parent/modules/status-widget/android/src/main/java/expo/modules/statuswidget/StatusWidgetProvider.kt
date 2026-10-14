package expo.modules.statuswidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray

private const val PREFS = "swag_status_widget"
private const val KEY_CHILDREN = "children"
private const val MAX_ROWS = 4

/** Home-screen widget: one line per child with the latest status, read from the app's last push. */
class StatusWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, build(context))
  }

  companion object {
    fun save(context: Context, json: String?) {
      val edit = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      if (json == null) edit.remove(KEY_CHILDREN) else edit.putString(KEY_CHILDREN, json)
      edit.apply()
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, StatusWidgetProvider::class.java))
      for (id in ids) manager.updateAppWidget(id, build(context))
    }

    private fun build(context: Context): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.swag_status_widget)
      val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_CHILDREN, null)
      val children = runCatching { JSONArray(raw ?: "[]") }.getOrDefault(JSONArray())

      views.setViewVisibility(R.id.swag_empty, if (children.length() == 0) View.VISIBLE else View.GONE)
      val rowIds = intArrayOf(R.id.swag_row_0, R.id.swag_row_1, R.id.swag_row_2, R.id.swag_row_3)
      val dotIds = intArrayOf(R.id.swag_dot_0, R.id.swag_dot_1, R.id.swag_dot_2, R.id.swag_dot_3)
      val nameIds = intArrayOf(R.id.swag_name_0, R.id.swag_name_1, R.id.swag_name_2, R.id.swag_name_3)
      val statusIds = intArrayOf(R.id.swag_status_0, R.id.swag_status_1, R.id.swag_status_2, R.id.swag_status_3)
      val timeIds = intArrayOf(R.id.swag_time_0, R.id.swag_time_1, R.id.swag_time_2, R.id.swag_time_3)

      for (i in 0 until MAX_ROWS) {
        val c = children.optJSONObject(i)
        if (c == null) {
          views.setViewVisibility(rowIds[i], View.GONE)
          continue
        }
        val color = runCatching { Color.parseColor(c.optString("color")) }.getOrDefault(Color.GRAY)
        views.setViewVisibility(rowIds[i], View.VISIBLE)
        views.setTextColor(dotIds[i], color)
        views.setTextViewText(nameIds[i], c.optString("name"))
        views.setTextViewText(statusIds[i], c.optString("label"))
        views.setTextColor(statusIds[i], color)
        views.setTextViewText(timeIds[i], relative(c.optLong("at", 0L)))
      }
      val extra = children.length() - MAX_ROWS
      views.setViewVisibility(R.id.swag_more, if (extra > 0) View.VISIBLE else View.GONE)
      if (extra > 0) views.setTextViewText(R.id.swag_more, "+$extra autres")

      // Tapping anywhere opens the app.
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      if (launch != null) {
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        views.setOnClickPendingIntent(R.id.swag_root, pending)
      }
      return views
    }

    private fun relative(at: Long): String {
      if (at <= 0L) return ""
      val minutes = (System.currentTimeMillis() - at) / 60_000
      return when {
        minutes < 1 -> "à l'instant"
        minutes < 60 -> "il y a $minutes min"
        minutes < 24 * 60 -> "il y a ${minutes / 60} h"
        else -> "il y a ${minutes / (24 * 60)} j"
      }
    }
  }
}
