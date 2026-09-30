package com.otpverify.gateway

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Calls to the OTP Verify server's gateway API, authenticated with the pairing code. */
object Api {
    class HttpException(val code: Int, message: String) : IOException(message)

    fun post(prefs: Prefs, path: String, body: JSONObject, timeoutMs: Int = 15_000): JSONObject {
        val conn = URL(prefs.server + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json")
            conn.setRequestProperty("authorization", "Bearer " + prefs.token)
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            val json = if (text.isNotBlank()) JSONObject(text) else JSONObject()
            if (code !in 200..299) throw HttpException(code, json.optString("message", "HTTP $code"))
            return json
        } finally {
            conn.disconnect()
        }
    }
}
