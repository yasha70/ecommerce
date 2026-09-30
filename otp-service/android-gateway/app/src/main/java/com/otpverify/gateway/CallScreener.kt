package com.otpverify.gateway

import android.telecom.Call
import android.telecom.CallScreeningService
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Missed-call verification. Android asks this service about every incoming call (once the app
 * holds the "call screening" role). We tell the server who is calling; if that number is waiting
 * to be verified, the call is cut at once (free for the caller). Any other call rings as normal.
 */
class CallScreener : CallScreeningService() {
    private val pool = Executors.newCachedThreadPool()

    override fun onScreenCall(details: Call.Details) {
        val prefs = Prefs(this)
        val incoming = details.callDirection == Call.Details.DIRECTION_INCOMING
        val number = details.handle?.schemeSpecificPart.orEmpty()
        if (!incoming || number.isBlank() || !prefs.callsEnabled || !prefs.configured) {
            respondToCall(details, allow())
            return
        }
        // Android gives us about 5 seconds to answer, so ask the server off the main thread and
        // give up after 4 (the call then rings as normal and the report is retried).
        pool.execute {
            val verified = try {
                Api.post(prefs, "/api/v1/gateway/call", JSONObject().put("from", number), 4_000)
                    .optBoolean("verified", false)
            } catch (e: Exception) {
                prefs.log("Call from ${mask(number)}: server did not answer (${e.message}); retrying")
                retryLater(prefs, number)
                false
            }
            if (verified) {
                prefs.log("Verified ${mask(number)} by missed call")
                respondToCall(details, CallResponse.Builder()
                    .setDisallowCall(true)
                    .setRejectCall(true)
                    .setSkipCallLog(false)
                    .setSkipNotification(true)
                    .build())
            } else {
                respondToCall(details, allow())
            }
        }
    }

    private fun allow() = CallResponse.Builder().build()

    /** A slow network should not lose the verification: report the call again shortly. */
    private fun retryLater(prefs: Prefs, number: String) {
        pool.execute {
            for (wait in longArrayOf(3_000, 10_000, 30_000)) {
                Thread.sleep(wait)
                try {
                    val ok = Api.post(prefs, "/api/v1/gateway/call", JSONObject().put("from", number))
                        .optBoolean("verified", false)
                    if (ok) prefs.log("Verified ${mask(number)} by missed call (after retry)")
                    return@execute
                } catch (_: Exception) {
                }
            }
        }
    }

    companion object {
        fun mask(n: String) = if (n.length > 4) "******" + n.takeLast(4) else n
    }
}
