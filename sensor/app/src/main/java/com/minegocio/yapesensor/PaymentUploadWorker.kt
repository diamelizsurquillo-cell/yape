package com.minegocio.yapesensor

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.gson.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class PaymentUploadWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    private val db = PaymentDatabase.getDatabase(appContext)
    private val prefs = PreferencesManager(appContext)
    private val client = OkHttpClient.Builder().build()

    override suspend fun doWork(): Result {
        val pendingPayments = db.pendingPaymentDao().getAllPending()
        if (pendingPayments.isEmpty()) {
            return Result.success()
        }

        val backendUrl = prefs.getBackendUrl()
        val apiKey = prefs.getApiKey()

        if (backendUrl.isEmpty()) {
            Log.e("PaymentUploadWorker", "La URL del Backend está vacía. No se pueden subir los pagos.")
            return Result.retry()
        }

        // Construir la URL completa del endpoint de pagos: si la url de ajustes no termina en /api/pagos, se le puede autocompletar.
        // Pero para flexibilidad del usuario, asumiremos que se ingresa el endpoint completo o lo normalizamos.
        var targetUrl = backendUrl.trim()
        if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
            targetUrl = "http://$targetUrl"
        }
        if (!targetUrl.endsWith("/api/pagos") && !targetUrl.endsWith("/api/pagos/")) {
            // Si el usuario ingresó solo el dominio/ip, añadimos la ruta por defecto
            targetUrl = if (targetUrl.endsWith("/")) "${targetUrl}api/pagos" else "$targetUrl/api/pagos"
        }

        val mediaType = "application/json; charset=utf-8".toMediaType()
        var hasFailure = false

        for (payment in pendingPayments) {
            try {
                val json = JsonObject().apply {
                    addProperty("remitente", payment.remitente)
                    addProperty("monto", payment.monto)
                    // Timestamp en segundos como es estándar en APIs (o en milisegundos si lo requiere, pero el enunciado dice 1234567890 que es segundos, así que convertimos a segundos dividiendo por 1000)
                    addProperty("timestamp", payment.timestamp / 1000)
                    addProperty("codigo_seguridad", payment.codigoSeguridad ?: "")
                    addProperty("banco", payment.banco)
                }

                val body = json.toString().toRequestBody(mediaType)
                val request = Request.Builder()
                    .url(targetUrl)
                    .addHeader("X-API-Key", apiKey)
                    .post(body)
                    .build()

                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        Log.i("PaymentUploadWorker", "Pago subido con éxito: ID ${payment.id}")
                        db.pendingPaymentDao().delete(payment)
                    } else {
                        Log.e("PaymentUploadWorker", "Error al subir pago ${payment.id}: Código ${response.code} - ${response.body?.string()}")
                        hasFailure = true
                    }
                }
            } catch (e: Exception) {
                Log.e("PaymentUploadWorker", "Error de red al subir pago ${payment.id}: ${e.message}", e)
                hasFailure = true
            }
        }

        return if (hasFailure) {
            Result.retry()
        } else {
            Result.success()
        }
    }
}
