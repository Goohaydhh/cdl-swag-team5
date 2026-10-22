package expo.modules.ringermode

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Reads the phone's ringer mode and reports every change (FR-13). No permission needed. */
class RingerModeModule : Module() {
  private var receiver: BroadcastReceiver? = null

  private val context: Context?
    get() = appContext.reactContext

  override fun definition() = ModuleDefinition {
    Name("RingerMode")

    Events("onChange")

    Function("getMode") { currentMode() }

    OnStartObserving("onChange") {
      val ctx = context ?: return@OnStartObserving
      if (receiver != null) return@OnStartObserving
      val r = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
          sendEvent("onChange", mapOf("mode" to currentMode()))
        }
      }
      val filter = IntentFilter(AudioManager.RINGER_MODE_CHANGED_ACTION)
      // System broadcasts still reach a non-exported receiver.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ctx.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        ctx.registerReceiver(r, filter)
      }
      receiver = r
    }

    OnStopObserving("onChange") { unregister() }

    OnDestroy { unregister() }
  }

  private fun unregister() {
    val r = receiver ?: return
    receiver = null
    runCatching { context?.unregisterReceiver(r) }
  }

  private fun currentMode(): String {
    val audio = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return "unknown"
    return when (audio.ringerMode) {
      AudioManager.RINGER_MODE_NORMAL -> "normal"
      AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
      AudioManager.RINGER_MODE_SILENT -> "silent"
      else -> "unknown"
    }
  }
}
