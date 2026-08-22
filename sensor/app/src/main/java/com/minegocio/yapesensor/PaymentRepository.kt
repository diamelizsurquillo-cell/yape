package com.minegocio.yapesensor

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class PaymentRepository(private val context: Context) {
    private val db = PaymentDatabase.getDatabase(context)
    private val workManager = WorkManager.getInstance(context)
    private val prefs = PreferencesManager(context)
    private val client = OkHttpClient.Builder().build()

    companion object {
        private const val TAG = "PaymentRepository"
    }

    /**
     * Intenta subir el pago inmediatamente. Si tiene éxito, no se encola.
     * Si falla de red o de servidor, lo guarda en Room como pendiente y arranca el Worker.
     */
    suspend fun saveAndUploadPayment(remitente: String, monto: Double, timestamp: Long, codigoSeguridad: String?, banco: String = "YAPE") {
        val success = tryUploadDirectly(remitente, monto, timestamp, codigoSeguridad, banco)
        if (!success) {
            Log.w(TAG, "El envío directo falló. Encolando pago en la base de datos local para reintento automático.")
            val payment = PendingPayment(
                remitente = remitente,
                monto = monto,
                timestamp = timestamp,
                codigoSeguridad = codigoSeguridad,
                banco = banco
            )
            db.pendingPaymentDao().insert(payment)
            triggerUpload()
        }
    }

    private suspend fun tryUploadDirectly(remitente: String, monto: Double, timestamp: Long, codigoSeguridad: String?, banco: String = "YAPE"): Boolean {
        return withContext(Dispatchers.IO) {
            val backendUrl = prefs.getBackendUrl()
            val apiKey = prefs.getApiKey()

            if (backendUrl.isEmpty()) {
                Log.e(TAG, "URL de backend no configurada.")
                return@withContext false
            }

            var targetUrl = backendUrl.trim()
            if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
                targetUrl = "http://$targetUrl"
            }
            if (!targetUrl.endsWith("/api/pagos") && !targetUrl.endsWith("/api/pagos/")) {
                targetUrl = if (targetUrl.endsWith("/")) "${targetUrl}api/pagos" else "$targetUrl/api/pagos"
            }

            DiagnosticLogger.log("🌐 Conectando a $targetUrl para registrar $banco S/ $monto...")

            try {
                val mediaType = "application/json; charset=utf-8".toMediaType()
                val json = JsonObject().apply {
                    addProperty("remitente", remitente)
                    addProperty("monto", monto)
                    addProperty("timestamp", timestamp / 1000) // Convertir a segundos
                    addProperty("codigo_seguridad", codigoSeguridad ?: "")
                    addProperty("banco", banco)
                }

                val body = json.toString().toRequestBody(mediaType)
                val request = Request.Builder()
                    .url(targetUrl)
                    .addHeader("X-API-Key", apiKey)
                    .post(body)
                    .build()

                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        Log.i(TAG, "Pago enviado exitosamente al backend de manera directa.")
                        DiagnosticLogger.log("🚀 ¡ÉXITO! Pago registrado en el servidor (HTTP ${response.code})")
                        true
                    } else {
                        val errBody = response.body?.string() ?: ""
                        Log.e(TAG, "Error de servidor al subir pago directamente: Código ${response.code}")
                        DiagnosticLogger.log("❌ Error del servidor: HTTP ${response.code} ($errBody)")
                        false
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Fallo de red al enviar pago directamente: ${e.message}")
                DiagnosticLogger.log("❌ Fallo de conexión: ${e.message}")
                false
            }
        }
    }

    /**
     * Lanza una tarea en segundo plano con restricciones de red para procesar y enviar la cola local.
     */
    fun triggerUpload() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val uploadRequest = OneTimeWorkRequestBuilder<PaymentUploadWorker>()
            .setConstraints(constraints)
            .build()

        workManager.enqueue(uploadRequest)
    }
}
