package com.otpverify.gateway

import android.Manifest
import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** One screen: connection settings, the permissions checklist, start/stop, and the activity log. */
class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var server: EditText
    private lateinit var token: EditText
    private lateinit var number: EditText
    private lateinit var calls: CheckBox
    private lateinit var sms: CheckBox
    private lateinit var status: TextView
    private lateinit var checklist: LinearLayout
    private lateinit var log: TextView
    private lateinit var startBtn: Button

    private val watcher = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == "status" || key == "log" || key == "running") runOnUiThread { refresh() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        val pad = dp(16)
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad * 2) }
        val scroll = ScrollView(this).apply { addView(col); fitsSystemWindows = true }

        col.addView(text("OTP Gateway", 24f, bold = true))
        col.addView(text("This phone sends verification SMS and answers missed calls for your OTP Verify server.", 14f, muted = true))
        status = text("", 16f, bold = true).also { it.setPadding(0, dp(12), 0, dp(4)) }
        col.addView(status)

        col.addView(label("Server address"))
        server = field("https://your-otp-site.vercel.app", InputType.TYPE_TEXT_VARIATION_URI).also { it.setText(prefs.server); col.addView(it) }
        col.addView(label("Pairing code (from the admin panel)"))
        token = field("gw_…", InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD).also { it.setText(prefs.token); col.addView(it) }
        col.addView(label("This phone's mobile number (customers ring it)"))
        number = field("98765 43210", InputType.TYPE_CLASS_PHONE).also { it.setText(prefs.number); col.addView(it) }

        calls = CheckBox(this).apply { text = "Missed-call verification (free)"; isChecked = prefs.callsEnabled }
        sms = CheckBox(this).apply { text = "Send SMS OTP (uses this SIM's SMS)"; isChecked = prefs.smsEnabled }
        col.addView(calls); col.addView(sms)
        calls.setOnCheckedChangeListener { _, _ -> refresh() }
        sms.setOnCheckedChangeListener { _, _ -> refresh() }

        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(8), 0, dp(8)) }
        startBtn = Button(this).apply { text = "Save & start"; setOnClickListener { saveAndStart() } }
        val stopBtn = Button(this).apply { text = "Stop"; setOnClickListener { prefs.running = false; GatewayService.stop(this@MainActivity) } }
        buttons.addView(startBtn, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        buttons.addView(stopBtn, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        col.addView(buttons)

        col.addView(text("Setup checklist", 16f, bold = true).also { it.setPadding(0, dp(12), 0, dp(4)) })
        checklist = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(checklist)

        col.addView(text("Activity", 16f, bold = true).also { it.setPadding(0, dp(16), 0, dp(4)) })
        log = text("", 12f).also { it.typeface = Typeface.MONOSPACE; it.setTextIsSelectable(true) }
        col.addView(log)

        setContentView(scroll)
    }

    override fun onResume() {
        super.onResume()
        prefs.onChange(watcher)
        refresh()
    }

    override fun onPause() {
        prefs.offChange(watcher)
        super.onPause()
    }

    private fun saveAndStart() {
        val url = server.text.toString().trim().trimEnd('/')
        if (!url.startsWith("https://") && !url.startsWith("http://")) return toast("Enter the server address, starting with https://")
        if (!token.text.toString().trim().startsWith("gw_")) return toast("Paste the pairing code from the admin panel (it starts with gw_)")
        if (calls.isChecked && number.text.toString().filter { it.isDigit() }.length < 10) return toast("Enter this phone's mobile number")
        prefs.server = url
        prefs.token = token.text.toString()
        prefs.number = number.text.toString()
        prefs.callsEnabled = calls.isChecked
        prefs.smsEnabled = sms.isChecked
        prefs.running = true
        GatewayService.start(this)
        toast("Gateway started")
        refresh()
    }

    private fun refresh() {
        status.text = if (prefs.running) prefs.status else "Stopped"
        startBtn.text = if (prefs.running) "Save & restart" else "Save & start"
        log.text = prefs.log.ifBlank { "Nothing yet." }

        checklist.removeAllViews()
        val items = mutableListOf<Triple<String, Boolean, () -> Unit>>()
        if (Build.VERSION.SDK_INT >= 33) {
            items += Triple("Show the status notification", granted(Manifest.permission.POST_NOTIFICATIONS)) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            }
        }
        if (sms.isChecked) {
            items += Triple("Allow sending SMS", granted(Manifest.permission.SEND_SMS)) {
                requestPermissions(arrayOf(Manifest.permission.SEND_SMS), 2)
            }
        }
        if (calls.isChecked) {
            val rm = getSystemService(RoleManager::class.java)
            items += Triple("Set as caller ID & spam app (to cut verification calls)", rm.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
                if (rm.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
                    startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING), 3)
                } else toast("This phone does not support call screening")
            }
        }
        val pm = getSystemService(PowerManager::class.java)
        items += Triple("Don't restrict battery (keeps the gateway running)", pm.isIgnoringBatteryOptimizations(packageName)) {
            try {
                startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
            } catch (_: Exception) {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
        }
        for ((title, done, action) in items) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(4), 0, dp(4)) }
            row.addView(text((if (done) "✓  " else "•  ") + title, 14f), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            if (!done) row.addView(Button(this).apply { text = "Allow"; setOnClickListener { action() } })
            checklist.addView(row)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refresh()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        refresh()
    }

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun text(s: String, size: Float, bold: Boolean = false, muted: Boolean = false) = TextView(this).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        if (muted) alpha = 0.7f
    }

    private fun label(s: String) = text(s, 13f, bold = true).apply { setPadding(0, dp(10), 0, dp(2)) }

    private fun field(hint: String, type: Int) = EditText(this).apply {
        this.hint = hint
        inputType = if (type == InputType.TYPE_CLASS_PHONE) type else InputType.TYPE_CLASS_TEXT or type
        isSingleLine = true
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
    }
}
