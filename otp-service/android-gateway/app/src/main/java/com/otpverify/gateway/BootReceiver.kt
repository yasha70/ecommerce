package com.otpverify.gateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restarts the gateway after the phone reboots or the app is updated, if it was running. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (Prefs(context).running) GatewayService.start(context)
    }
}
