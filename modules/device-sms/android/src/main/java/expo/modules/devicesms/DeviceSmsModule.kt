package expo.modules.devicesms

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
import android.telephony.SmsMessage
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Send SMS from the teacher's own SIM.
 *
 * Why this exists at all: ClassCare's users are private tutors in Turkmenistan,
 * where a commercial SMS gateway is either unavailable or priced per message in
 * hard currency. The teacher already has a SIM with a bundle on it. This module
 * lets the app use it.
 *
 * Two things about `SmsManager` that shape everything below:
 *
 *  1. Sending is fire-and-forget. `sendMultipartTextMessage` returns
 *     immediately and reports the outcome later through a broadcast, so a
 *     promise cannot resolve until that broadcast arrives — and it may never
 *     arrive if the radio is in a bad state, hence the timeout.
 *
 *  2. A long message is split into parts and each part reports separately.
 *     One failed part means a message the recipient sees as truncated, so the
 *     send only counts as successful when every part reports OK.
 *
 * Also note Android's own outgoing-SMS check: past roughly 30 messages an hour
 * the framework puts up a system dialog per message asking the user to allow
 * it. Nothing here can suppress that — it is the platform protecting the user
 * from exactly this API — so the JS side warns before a large batch and the
 * timeout is generous enough to survive a teacher tapping through dialogs.
 */
class DeviceSmsModule : Module() {
  companion object {
    private const val EXTRA_ID = "expo.modules.devicesms.ID"
    /** Long enough to survive the system's per-message confirmation dialog. */
    private const val SEND_TIMEOUT_MS = 120_000L
  }

  /** One in-flight send. Parts report one at a time and the last one settles it. */
  private class Pending(
    val promise: Promise,
    val parts: Int,
    var remaining: Int,
    var failure: String? = null,
    var timeout: Runnable? = null,
  )

  private val pending = ConcurrentHashMap<String, Pending>()
  private val requestCode = AtomicInteger(1000)
  private val main = Handler(Looper.getMainLooper())
  private var registered = false

  private val context: Context
    get() = appContext.reactContext ?: throw MissingContextException()

  private val sentAction: String
    get() = "${context.packageName}.DEVICE_SMS_SENT"

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
      val id = intent.getStringExtra(EXTRA_ID) ?: return
      val entry = pending[id] ?: return

      if (resultCode != Activity.RESULT_OK && entry.failure == null) {
        entry.failure = describeResult(resultCode)
      }

      entry.remaining -= 1
      if (entry.remaining > 0) return

      // Every part has reported. Settle once and never again.
      pending.remove(id)
      entry.timeout?.let { main.removeCallbacks(it) }

      val failure = entry.failure
      if (failure == null) {
        entry.promise.resolve(mapOf("id" to id, "parts" to entry.parts))
      } else {
        entry.promise.reject(SendFailedException(failure))
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("DeviceSms")

    OnCreate {
      if (registered) return@OnCreate
      // Wrapped because a throw here fails the whole module registration, and
      // an app that cannot start is a far worse outcome than one that cannot
      // send SMS. `sendAsync` throws a reportable error if this never ran.
      runCatching {
        // NOT_EXPORTED is required from Android 14 and correct everywhere: the
        // only sender is our own PendingIntent.
        ContextCompat.registerReceiver(
          context,
          receiver,
          IntentFilter(sentAction),
          ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        registered = true
      }
    }

    OnDestroy {
      if (!registered) return@OnDestroy
      runCatching { context.unregisterReceiver(receiver) }
      registered = false
      // Anything still in flight will never be answered now.
      pending.values.forEach { entry ->
        entry.timeout?.let { main.removeCallbacks(it) }
        entry.promise.reject(SendFailedException("interrupted"))
      }
      pending.clear()
    }

    /**
     * Whether this device can send at all. False on a tablet with no radio,
     * which is worth knowing before the UI offers the option.
     */
    Function("isAvailable") {
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)
    }

    Function("hasPermission") {
      ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) ==
        PackageManager.PERMISSION_GRANTED
    }

    AsyncFunction("getPermissionsAsync") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.SEND_SMS,
      )
    }

    AsyncFunction("requestPermissionsAsync") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.SEND_SMS,
      )
    }

    /**
     * Segment arithmetic, from the platform rather than from a guess.
     *
     * This matters more than it looks. Turkmen uses ä, ň, ö, ü, ý and ž, none
     * of which are in the GSM 7-bit alphabet, so a single one of them drops the
     * whole message to UCS-2 and the limit from 160 characters to 70. A teacher
     * who does not see that coming pays three times what they expected.
     */
    Function("countSegments") { body: String ->
      val info = SmsMessage.calculateLength(body, false)
      mapOf(
        "segments" to info[0],
        "used" to info[1],
        "remaining" to info[2],
        "encoding" to when (info[3]) {
          1 -> "gsm7"
          2 -> "ucs2"
          3 -> "8bit"
          else -> "unknown"
        },
      )
    }

    /**
     * Send one message. Resolves when every part has been accepted by the
     * network, rejects with a coded reason otherwise.
     *
     * `id` is the caller's, and is what ties the broadcast back to this promise.
     */
    AsyncFunction("sendAsync") { id: String, phone: String, body: String, promise: Promise ->
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) !=
        PackageManager.PERMISSION_GRANTED
      ) {
        throw PermissionDeniedException()
      }
      // Without the receiver nothing would ever settle the promise, so fail
      // now with a reason rather than hanging until the timeout.
      if (!registered) throw SendFailedException("receiver_unavailable")
      if (phone.isBlank()) throw SendFailedException("no_number")
      if (body.isEmpty()) throw SendFailedException("empty_body")
      if (pending.containsKey(id)) throw SendFailedException("duplicate_id")

      val manager = smsManager()
      val parts = manager.divideMessage(body)
      if (parts.isNullOrEmpty()) throw SendFailedException("empty_body")

      val flags = PendingIntent.FLAG_UPDATE_CURRENT or
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

      val sentIntents = ArrayList<PendingIntent>(parts.size)
      for (i in parts.indices) {
        val intent = Intent(sentAction)
          .setPackage(context.packageName)
          .putExtra(EXTRA_ID, id)
        // A distinct request code per part: PendingIntent equality ignores
        // extras, so reusing one would collapse every part into a single
        // intent and we would hear back once instead of `parts.size` times.
        sentIntents.add(
          PendingIntent.getBroadcast(context, requestCode.getAndIncrement(), intent, flags),
        )
      }

      val entry = Pending(promise, parts.size, parts.size)
      pending[id] = entry

      val expire = Runnable {
        pending.remove(id)?.promise?.reject(SendFailedException("timeout"))
      }
      entry.timeout = expire
      main.postDelayed(expire, SEND_TIMEOUT_MS)

      try {
        manager.sendMultipartTextMessage(phone, null, parts, sentIntents, null)
      } catch (e: Exception) {
        pending.remove(id)
        main.removeCallbacks(expire)
        // Thrown synchronously for a malformed number, among other things.
        throw SendFailedException(e.message ?: "send_failed")
      }
    }
  }

  private fun smsManager(): SmsManager =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      context.getSystemService(SmsManager::class.java)
    } else {
      @Suppress("DEPRECATION")
      SmsManager.getDefault()
    }

  /**
   * Result codes as stable strings for the JS side to translate.
   *
   * Deliberately numeric literals rather than the `SmsManager` constants: the
   * later ones were added across several API levels and referencing them
   * directly would raise the module's floor for no benefit.
   */
  private fun describeResult(code: Int) = when (code) {
    1 -> "generic_failure"
    2 -> "radio_off"
    3 -> "null_pdu"
    4 -> "no_service"
    5 -> "limit_exceeded"
    6 -> "fdn_check_failed"
    7 -> "short_code_not_allowed"
    8 -> "short_code_never_allowed"
    9 -> "radio_not_available"
    else -> "failed_$code"
  }
}

class MissingContextException :
  CodedException("ERR_DEVICE_SMS_NO_CONTEXT", "The app context is not available.", null)

class PermissionDeniedException :
  CodedException("ERR_DEVICE_SMS_PERMISSION", "Permission to send SMS was not granted.", null)

class SendFailedException(reason: String) :
  CodedException("ERR_DEVICE_SMS_SEND", reason, null)
