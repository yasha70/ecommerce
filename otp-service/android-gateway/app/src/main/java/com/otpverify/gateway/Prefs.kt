package com.otpverify.gateway

import android.content.Context
import android.content.SharedPreferences
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Settings typed into the app, plus a short activity log shown on the main screen. */
class Prefs(context: Context) {
    private val p: SharedPreferences =
        context.applicationContext.getSharedPreferences("gateway", Context.MODE_PRIVATE)

    var server: String
        get() = p.getString("server", "") ?: ""
        set(v) = p.edit().putString("server", v.trim().trimEnd('/')).apply()

    var token: String
        get() = p.getString("token", "") ?: ""
        set(v) = p.edit().putString("token", v.trim()).apply()

    var number: String
        get() = p.getString("number", "") ?: ""
        set(v) = p.edit().putString("number", v.trim()).apply()

    var smsEnabled: Boolean
        get() = p.getBoolean("sms", true)
        set(v) = p.edit().putBoolean("sms", v).apply()

    var callsEnabled: Boolean
        get() = p.getBoolean("calls", true)
        set(v) = p.edit().putBoolean("calls", v).apply()

    /** Whether the user turned the gateway on (it restarts after a reboot when true). */
    var running: Boolean
        get() = p.getBoolean("running", false)
        set(v) = p.edit().putBoolean("running", v).apply()

    var status: String
        get() = p.getString("status", "Stopped") ?: "Stopped"
        set(v) = p.edit().putString("status", v).apply()

    val configured: Boolean
        get() = server.startsWith("http") && token.startsWith("gw_")

    val log: String
        get() = p.getString("log", "") ?: ""

    @Synchronized
    fun log(line: String) {
        val time = SimpleDateFormat("dd MMM HH:mm:ss", Locale.getDefault()).format(Date())
        val lines = ("$time  $line\n" + log).lineSequence().take(60).joinToString("\n")
        p.edit().putString("log", lines).apply()
    }

    fun onChange(listener: SharedPreferences.OnSharedPreferenceChangeListener) =
        p.registerOnSharedPreferenceChangeListener(listener)

    fun offChange(listener: SharedPreferences.OnSharedPreferenceChangeListener) =
        p.unregisterOnSharedPreferenceChangeListener(listener)
}
