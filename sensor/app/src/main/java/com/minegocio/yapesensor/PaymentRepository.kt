package com.minegocio.yapesensor

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.Locale

class PaymentRepository(private val context: Context) {
    private val db = PaymentDatabase.getDatabase(context)
    private val workManager = WorkManager.getInstance(context)
    private val prefs = PreferencesManager(context)

    companion object {
        private const val TAG = "PaymentRepository"
        private const val UNIQUE_UPLOAD_WORK = "yape_expedited_upload_work"
    }

    data class PairingResult(
        val success: Boolean,
        val businessName: String = "",
        val errorMessage: String = ""
    )

    /**
     * Arquitectura Write-Ahead Queue (Cero Pagos Perdidos y Cero Duplicados):
     * 1. Genera event_uid determinístico.
     * 2. Persiste primero en Room SQLite local (<5ms). Si ya existía el mismo event_uid, ignora duplicado.
     * 3. Dispara subida directa inmediata (<300ms) por pool HTTP/2 con firma HMAC-SHA256.
     * 4. Si se confirma 2xx, limpia de Room; si no hay red, encola Worker Expedited.
     */
    suspend fun saveAndUploadPayment(
        remitente: String,
        monto: Double,
        timestamp: Long,
        codigoSeguridad: String?,
        banco: String = "YAPE",
        packageName: String = "com.bcp.innovacxion.yapeapp"
    ) {
        val cleanSender = remitente.trim().take(100)
        val cleanBank = banco.trim().uppercase(Locale.US)
        val eventUid = NetworkClient.computeEventUid(
            packageName = packageName,
            postTimeMs = timestamp,
            banco = cleanBank,
            monto = monto,
            remitente = cleanSender
        )

        val pending = PendingPayment(
            eventUid = eventUid,
            remitente = cleanSender,
            monto = monto,
            timestamp = timestamp,
            codigoSeguridad = codigoSeguridad,
            banco = cleanBank
        )

        val rowId = db.pendingPaymentDao().insertIgnore(pending)
        if (rowId == -1L) {
            DiagnosticLogger.log("ℹ️ Notificación repetida ignorada localmente ($eventUid)")
            return
        }

        val uploadedNow = uploadSinglePayment(pending)
        if (uploadedNow) {
            db.pendingPaymentDao().deleteByEventUid(eventUid)
        } else {
            Log.w(TAG, "Sin conexión momentánea. Pago resguardado en cola local ($eventUid).")
            triggerUpload()
        }
    }

    suspend fun uploadSinglePayment(payment: PendingPayment): Boolean {
        return withContext(Dispatchers.IO) {
            val baseUrl = NetworkClient.normalizeBaseUrl(prefs.getBackendUrl())
            val apiKey = prefs.getApiKey()
            val hmacSecret = prefs.getHmacSecret()

            if (baseUrl.isEmpty() || apiKey.isEmpty()) {
                DiagnosticLogger.log("⚠️ Falta vincular el celular con tu código de 6 dígitos o API Key.")
                return@withContext false
            }

            val targetUrl = "$baseUrl/api/pagos"
            val timestampSec = payment.timestamp / 1000
            val reqTsSec = System.currentTimeMillis() / 1000

            try {
                val mediaType = "application/json; charset=utf-8".toMediaType()
                val json = JsonObject().apply {
                    addProperty("event_uid", payment.eventUid)
                    addProperty("remitente", payment.remitente)
                    addProperty("monto", payment.monto)
                    addProperty("timestamp", timestampSec)
                    addProperty("codigo_seguridad", payment.codigoSeguridad ?: "")
                    addProperty("banco", payment.banco)
                }

                val reqBuilder = Request.Builder()
                    .url(targetUrl)
                    .addHeader("X-API-Key", apiKey)
                    .addHeader("X-Request-Timestamp", reqTsSec.toString())

                if (hmacSecret.isNotBlank()) {
                    val canonical = String.format(
                        Locale.US,
                        "%d|%s|%s|%.2f|%d|%s",
                        reqTsSec,
                        payment.eventUid,
                        payment.banco.uppercase(Locale.US),
                        payment.monto,
                        timestampSec,
                        payment.remitente
                    )
                    val sig = NetworkClient.signHmacSha256(hmacSecret, canonical)
                    reqBuilder.addHeader("X-Signature-256", sig)
                }

                val request = reqBuilder
                    .post(json.toString().toRequestBody(mediaType))
                    .build()

                NetworkClient.httpClient.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        DiagnosticLogger.log("🚀 ¡PAGO ENTREGADO EN TIEMPO REAL! (${payment.banco} S/ ${String.format(Locale.US, "%.2f", payment.monto)})")
                        true
                    } else {
                        val errBody = response.body?.string() ?: ""
                        DiagnosticLogger.log("❌ Servidor rechazó envío (HTTP ${response.code}): $errBody")
                        false
                    }
                }
            } catch (e: Exception) {
                DiagnosticLogger.log("📡 Microcorte de señal (${e.message}). Reintento automático activo.")
                false
            }
        }
    }

    /**
     * Vinculación mágica en 1 toque usando el Código de 6 Dígitos generado en el Panel Web.
     */
    suspend fun redeemPairingCode(serverUrlInput: String, sixDigitCode: String): PairingResult {
        return withContext(Dispatchers.IO) {
            val baseUrl = NetworkClient.normalizeBaseUrl(serverUrlInput.ifBlank { PreferencesManager.DEFAULT_CLOUD_URL })
            val cleanCode = sixDigitCode.filter { it.isDigit() }
            if (cleanCode.length != 6) {
                return@withContext PairingResult(false, errorMessage = "El código debe tener exactamente 6 dígitos.")
            }

            val deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".trim()
            val mediaType = "application/json; charset=utf-8".toMediaType()
            val payload = JsonObject().apply {
                addProperty("codigo", cleanCode)
                addProperty("device_name", deviceModel)
            }

            try {
                val request = Request.Builder()
                    .url("$baseUrl/api/pair")
                    .put(payload.toString().toRequestBody(mediaType))
                    .build()

                NetworkClient.httpClient.newCall(request).execute().use { res ->
                    val rawBody = res.body?.string() ?: "{}"
                    val json = try {
                        JsonParser.parseString(rawBody).asJsonObject
                    } catch (_: Exception) {
                        JsonObject()
                    }

                    if (!res.isSuccessful) {
                        val msg = json.get("error")?.asString ?: "Código inválido o vencido (HTTP ${res.code})"
                        return@withContext PairingResult(false, errorMessage = msg)
                    }

                    val apiKey = json.get("api_key")?.asString ?: ""
                    val hmacSecret = json.get("hmac_secret")?.asString ?: ""
                    val resolvedUrl = json.get("backend_url")?.asString?.ifBlank { baseUrl } ?: baseUrl
                    val businessName = json.get("nombre_comercial")?.asString ?: "Mi Negocio"

                    prefs.saveSettings(
                        url = resolvedUrl,
                        key = apiKey,
                        hmacSecret = hmacSecret,
                        businessName = businessName
                    )
                    DiagnosticLogger.log("✅ Vinculado con éxito a '$businessName' con firma criptográfica HMAC activa.")
                    PairingResult(true, businessName = businessName)
                }
            } catch (e: Exception) {
                PairingResult(false, errorMessage = "Error de conexión: ${e.message}")
            }
        }
    }

    /**
     * Envía pulso de vida (Heartbeat + % batería) cada 60s para iluminar "🟢 Celular Activo" en Caja.
     */
    suspend fun sendHeartbeat(): Boolean {
        return withContext(Dispatchers.IO) {
            val baseUrl = NetworkClient.normalizeBaseUrl(prefs.getBackendUrl())
            val apiKey = prefs.getApiKey()
            if (baseUrl.isEmpty() || apiKey.isEmpty()) return@withContext false

            val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
            val batteryPct = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 } ?: -1
            val deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".trim().take(60)
            val reqTs = System.currentTimeMillis() / 1000
            val hmacSecret = prefs.getHmacSecret()

            val payload = JsonObject().apply {
                if (batteryPct >= 0) addProperty("battery", batteryPct)
                addProperty("device_name", deviceModel)
            }

            try {
                val mediaType = "application/json; charset=utf-8".toMediaType()
                val builder = Request.Builder()
                    .url("$baseUrl/api/pair")
                    .addHeader("X-API-Key", apiKey)
                    .addHeader("X-Request-Timestamp", reqTs.toString())

                if (hmacSecret.isNotBlank()) {
                    val canonical = "$reqTs|heartbeat|$batteryPct|$deviceModel"
                    builder.addHeader("X-Signature-256", NetworkClient.signHmacSha256(hmacSecret, canonical))
                }

                val req = builder.patch(payload.toString().toRequestBody(mediaType)).build()
                NetworkClient.httpClient.newCall(req).execute().use { res ->
                    if (res.isSuccessful) {
                        val raw = res.body?.string() ?: "{}"
                        try {
                            val json = JsonParser.parseString(raw).asJsonObject
                            val upgradedHmac = json.get("hmac_secret")?.asString
                            prefs.updateHmacSecretIfProvided(upgradedHmac)
                        } catch (_: Exception) {}
                        true
                    } else {
                        false
                    }
                }
            } catch (_: Exception) {
                false
            }
        }
    }

    fun triggerUpload() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val uploadRequest = OneTimeWorkRequestBuilder<PaymentUploadWorker>()
            .setConstraints(constraints)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()

        workManager.enqueueUniqueWork(
            UNIQUE_UPLOAD_WORK,
            ExistingWorkPolicy.REPLACE,
            uploadRequest
        )
    }
}
