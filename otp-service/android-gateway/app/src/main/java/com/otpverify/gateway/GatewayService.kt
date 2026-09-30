package com.otpverify.gateway

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.telephony.SmsManager
import org.json.JSONObject

/**
 * Keeps the phone connected to the OTP Verify server: every few seconds it reports that it is
 * online (and its number, for missed calls) and picks up any SMS the server wants sent.
 * Runs as a foreground service so Android does not stop it.
 */
class GatewayService : Service() {
    @Volatile private var alive = false
    private var worker: Thread? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private lateinit var prefs: Prefs

    private val sentReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val id = intent.getStringExtra("id") ?: return
            val to = intent.getStringExtra("to").orEmpty()
            val ok = resultCode == android.app.Activity.RESULT_OK
            prefs.log(if (ok) "SMS sent to ${CallScreener.mask(to)}" else "SMS to ${CallScreener.mask(to)} failed (code $resultCode)")
            Thread {
                try {
                    Api.post(prefs, "/api/v1/gateway/report",
                        JSONObject().put("id", id).put("ok", ok).put("error", if (ok) "" else "code $resultCode"))
                } catch (_: Exception) {
                }
            }.start()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        val filter = IntentFilter(ACTION_SENT)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(sentReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else registerReceiver(sentReceiver, filter)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            prefs.running = false
            stopSelf()
            return START_NOT_STICKY
        }
        startInForeground("Starting…")
        if (!alive) {
            alive = true
            wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "otpgateway:poll").apply { setReferenceCounted(false) }
            worker = Thread(::loop, "gateway-poll").apply { start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        alive = false
        worker?.interrupt()
        wakeLock?.let { if (it.isHeld) it.release() }
        try { unregisterReceiver(sentReceiver) } catch (_: Exception) {}
        prefs.status = "Stopped"
        prefs.log("Gateway stopped")
        super.onDestroy()
    }

    private fun loop() {
        prefs.log("Gateway started")
        var failures = 0
        while (alive) {
            var waitSeconds: Int
            try {
                wakeLock?.acquire(60_000)
                val res = Api.post(prefs, "/api/v1/gateway/poll", JSONObject()
                    .put("number", prefs.number)
                    .put("sms", prefs.smsEnabled)
                    .put("calls", prefs.callsEnabled)
                    .put("battery", battery())
                    .put("version", BuildConfigInfo.VERSION))
                val messages = res.optJSONArray("messages")
                for (i in 0 until (messages?.length() ?: 0)) {
                    val m = messages!!.getJSONObject(i)
                    sendSms(m.getString("id"), m.getString("to"), m.getString("message"))
                }
                waitSeconds = res.optInt("next_poll", 10).coerceIn(2, 120)
                if (failures > 0) prefs.log("Connected again")
                failures = 0
                setStatus("Online · " + listOfNotNull(
                    if (prefs.callsEnabled) "missed calls" else null,
                    if (prefs.smsEnabled) "SMS" else null).joinToString(" + "))
            } catch (e: Api.HttpException) {
                failures++
                if (e.code == 401) {
                    setStatus("Not paired: get a new pairing code from the admin panel")
                    prefs.log("Server says this phone is not paired")
                    waitSeconds = 120
                } else {
                    setStatus("Server error: ${e.message}")
                    waitSeconds = backoff(failures)
                }
            } catch (e: Exception) {
                failures++
                if (failures == 1 || failures % 20 == 0) prefs.log("No connection: ${e.message}")
                setStatus("Offline, retrying… (${e.javaClass.simpleName})")
                waitSeconds = backoff(failures)
            } finally {
                wakeLock?.let { if (it.isHeld) it.release() }
            }
            try { Thread.sleep(waitSeconds * 1000L) } catch (_: InterruptedException) { break }
        }
    }

    private fun backoff(failures: Int) = minOf(60, 5 * failures)

    private fun sendSms(id: String, to: String, text: String) {
        try {
            val sms = if (Build.VERSION.SDK_INT >= 31) getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
            val sent = PendingIntent.getBroadcast(this, id.hashCode(),
                Intent(ACTION_SENT).setPackage(packageName).putExtra("id", id).putExtra("to", to),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val parts = sms.divideMessage(text)
            if (parts.size == 1) sms.sendTextMessage(to, null, text, sent, null)
            else {
                // report once, when the last part has gone
                val intents = ArrayList<PendingIntent?>(parts.size).apply { repeat(parts.size - 1) { add(null) }; add(sent) }
                sms.sendMultipartTextMessage(to, null, parts, intents, null)
            }
        } catch (e: Exception) {
            prefs.log("SMS to ${CallScreener.mask(to)} failed: ${e.message}")
            try {
                Api.post(prefs, "/api/v1/gateway/report", JSONObject().put("id", id).put("ok", false).put("error", e.message))
            } catch (_: Exception) {
            }
        }
    }

    private fun battery(): Int {
        val bm = getSystemService(BATTERY_SERVICE) as BatteryManager
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    private fun setStatus(text: String) {
        if (prefs.status != text) {
            prefs.status = text
            getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))
        }
    }

    private fun startInForeground(text: String) {
        val n = notification(text)
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(NOTIFICATION_ID, n)
    }

    private fun notification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Gateway status", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("OTP Gateway")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL = "gateway"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_SENT = "com.otpverify.gateway.SMS_SENT"
        private const val ACTION_STOP = "com.otpverify.gateway.STOP"

        fun start(context: Context) {
            context.startForegroundService(Intent(context, GatewayService::class.java))
        }

        fun stop(context: Context) {
            context.startService(Intent(context, GatewayService::class.java).setAction(ACTION_STOP))
        }
    }
}

object BuildConfigInfo {
    const val VERSION = "1.0"
}
