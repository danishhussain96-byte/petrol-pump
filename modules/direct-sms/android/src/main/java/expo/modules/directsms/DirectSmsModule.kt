package expo.modules.directsms

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * Sends an SMS straight from the phone's SIM (no SMS app opened). Needs the SEND_SMS
 * permission, which the JS side requests first. Resolves with "sent" once the network
 * accepts every part, or "unknown" if no report arrives in time.
 */
class DirectSmsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("DirectSms")

    Function("isAvailable") {
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)
    }

    Function("hasPermission") {
      ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
    }

    AsyncFunction("send") { phone: String, message: String, promise: Promise ->
      send(phone, message, promise)
    }
  }

  private fun smsManager(): SmsManager =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      context.getSystemService(SmsManager::class.java)
    } else {
      @Suppress("DEPRECATION")
      SmsManager.getDefault()
    }

  private fun send(phone: String, message: String, promise: Promise) {
    val ctx = context
    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
      promise.reject(CodedException("ERR_NO_PERMISSION", "SMS permission not granted", null))
      return
    }
    val manager = smsManager()
    val parts = manager.divideMessage(message)
    val action = "${ctx.packageName}.DIRECT_SMS_SENT.${UUID.randomUUID()}"
    val handler = Handler(Looper.getMainLooper())
    var remaining = parts.size
    var failure: Int? = null
    var done = false

    lateinit var receiver: BroadcastReceiver
    val finish = { result: String? ->
      if (!done) {
        done = true
        try {
          ctx.unregisterReceiver(receiver)
        } catch (_: Exception) {
        }
        if (result != null) promise.resolve(result)
        else promise.reject(CodedException("ERR_SEND_FAILED", "SMS not sent (code $failure)", null))
      }
    }
    receiver = object : BroadcastReceiver() {
      override fun onReceive(c: Context?, intent: Intent?) {
        if (resultCode != Activity.RESULT_OK) failure = resultCode
        remaining -= 1
        if (remaining <= 0) finish(if (failure == null) "sent" else null)
      }
    }
    ContextCompat.registerReceiver(ctx, receiver, IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED)

    val sentIntents = ArrayList<PendingIntent>()
    for (i in parts.indices) {
      val intent = Intent(action).setPackage(ctx.packageName)
      sentIntents.add(PendingIntent.getBroadcast(ctx, i, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT))
    }
    try {
      if (parts.size > 1) manager.sendMultipartTextMessage(phone, null, parts, sentIntents, null)
      else manager.sendTextMessage(phone, null, message, sentIntents[0], null)
    } catch (e: Exception) {
      done = true
      try {
        ctx.unregisterReceiver(receiver)
      } catch (_: Exception) {
      }
      promise.reject(CodedException("ERR_SEND_FAILED", e.message ?: "SMS not sent", e))
      return
    }
    // Some phones never report back; don't leave the app waiting.
    handler.postDelayed({ finish("unknown") }, 30_000)
  }
}
