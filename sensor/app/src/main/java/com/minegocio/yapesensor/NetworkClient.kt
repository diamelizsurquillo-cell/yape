package com.minegocio.yapesensor

import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object NetworkClient {

    // Pool persistente HTTP/2 para entregar pagos en <300ms sin renegociar TLS cada vez
    val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectionPool(ConnectionPool(5, 5, TimeUnit.MINUTES))
            .connectTimeout(5, TimeUnit.SECONDS)
            .writeTimeout(8, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    fun normalizeBaseUrl(rawUrl: String): String {
        var clean = rawUrl.trim()
        if (clean.isEmpty()) return ""
        // Quitar sufijo /api/pagos si el usuario pegó la ruta completa
        clean = clean.removeSuffix("/").removeSuffix("/api/pagos").removeSuffix("/")
        if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
            val lower = clean.lowercase(Locale.US)
            val isLocalLan = lower.startsWith("localhost") ||
                    lower.startsWith("127.") ||
                    lower.startsWith("192.168.") ||
                    lower.startsWith("10.")
            clean = if (isLocalLan) "http://$clean" else "https://$clean"
        }
        return clean.trimEnd('/')
    }

    fun computeEventUid(
        packageName: String,
        postTimeMs: Long,
        banco: String,
        monto: Double,
        remitente: String
    ): String {
        val raw = String.format(
            Locale.US,
            "%s|%d|%s|%.2f|%s",
            packageName.lowercase(Locale.US),
            postTimeMs / 1000,
            banco.uppercase(Locale.US),
            monto,
            remitente.trim().lowercase(Locale.US)
        )
        val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
        return "ev_" + digest.joinToString("") { "%02x".format(it) }.take(28)
    }

    fun signHmacSha256(secret: String, canonicalMessage: String): String {
        if (secret.isBlank()) return ""
        val mac = Mac.getInstance("HmacSHA256")
        val keySpec = SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256")
        mac.init(keySpec)
        val bytes = mac.doFinal(canonicalMessage.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
