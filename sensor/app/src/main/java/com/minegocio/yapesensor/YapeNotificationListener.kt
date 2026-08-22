package com.minegocio.yapesensor

import android.content.ComponentName
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class YapeNotificationListener : NotificationListenerService() {

    companion object {
        const val YAPE_PACKAGE_NAME = "com.bcp.innovacxion.yapeapp"
        private const val TAG = "YapeNotificationListener"

        fun tryRebind(context: android.content.Context) {
            try {
                val componentName = ComponentName(context, YapeNotificationListener::class.java)
                requestRebind(componentName)
                DiagnosticLogger.log("🔄 Solicitada reconexión de NotificationListenerService...")
            } catch (e: Exception) {
                Log.e(TAG, "Error en requestRebind: ${e.message}")
            }
        }
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO)
    private lateinit var repository: PaymentRepository
    private lateinit var preferences: PreferencesManager

    override fun onCreate() {
        super.onCreate()
        repository = PaymentRepository(applicationContext)
        preferences = PreferencesManager(applicationContext)
        Log.i(TAG, "Yape Notification Listener Service Creado")
        DiagnosticLogger.log("⚙️ Servicio NotificationListener creado.")
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.i(TAG, "Listener CONECTADO exitosamente al sistema.")
        DiagnosticLogger.setServiceConnected(true)
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.w(TAG, "Listener DESCONECTADO del sistema. Reintentando reconexión...")
        DiagnosticLogger.setServiceConnected(false)
        tryRebind(applicationContext)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val packageName = sbn.packageName ?: ""
        val extras = sbn.notification.extras
        val title = extras.getString(NotificationCompat.EXTRA_TITLE)?.trim()
        
        val extraText = extras.getString(NotificationCompat.EXTRA_TEXT)
            ?: extras.getCharSequence(NotificationCompat.EXTRA_TEXT)?.toString()
        val bigText = extras.getString(NotificationCompat.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(NotificationCompat.EXTRA_BIG_TEXT)?.toString()
        val subText = extras.getString(NotificationCompat.EXTRA_SUB_TEXT)
            ?: extras.getCharSequence(NotificationCompat.EXTRA_SUB_TEXT)?.toString()
        val tickerText = sbn.notification.tickerText?.toString()

        val text = listOfNotNull(bigText, extraText, tickerText, subText)
            .maxByOrNull { it.length }?.trim()
        
        val timestamp = sbn.postTime

        val combinedSearchText = "$title $text $packageName".lowercase()
        val isPaymentCandidate = packageName.equals(YAPE_PACKAGE_NAME, ignoreCase = true) ||
                packageName.contains("yape", ignoreCase = true) ||
                packageName.contains("bbva", ignoreCase = true) ||
                combinedSearchText.contains("yape") ||
                combinedSearchText.contains("bbva") ||
                combinedSearchText.contains("cobro con qr") ||
                combinedSearchText.contains("te yapeó") ||
                combinedSearchText.contains("te envió un pago") ||
                combinedSearchText.contains("te hizo un pago") ||
                combinedSearchText.contains("confirmación de pago")

        if (!isPaymentCandidate) {
            return
        }

        DiagnosticLogger.log("📩 Notificación de pago detectada de [$packageName]\nTítulo: $title\nTexto: $text")

        // 1. Intentar parsear el texto principal
        var parsed = YapeNotificationParser.parse(title, text, timestamp, packageName)
        
        // 2. Intentar parsear texto del bigText explícitamente si difiere
        if (parsed == null && bigText != null && bigText != text) {
            parsed = YapeNotificationParser.parse(title, bigText.trim(), timestamp, packageName)
        }

        // 3. Intentar con título + texto combinado si falló
        if (parsed == null && title != null && text != null) {
            parsed = YapeNotificationParser.parse(title, "$title $text", timestamp, packageName)
        }

        // 4. Último intento: parsear solo el título
        if (parsed == null && title != null) {
            parsed = YapeNotificationParser.parse(title, title, timestamp, packageName)
        }

        if (parsed != null) {
            DiagnosticLogger.log("💰 ¡PAGO ${parsed.banco} EXTRAÍDO CON ÉXITO! Remitente: ${parsed.remitente} | Monto: S/ ${parsed.monto} | Banco: ${parsed.banco}")
            serviceScope.launch {
                repository.saveAndUploadPayment(
                    remitente = parsed.remitente,
                    monto = parsed.monto,
                    timestamp = parsed.timestamp,
                    codigoSeguridad = parsed.codigoSeguridad,
                    banco = parsed.banco
                )
            }
        } else {
            DiagnosticLogger.log("⚠️ No se pudo extraer monto/remitente del texto: '$text'")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
        DiagnosticLogger.setServiceConnected(false)
        Log.i(TAG, "Yape Notification Listener Service Destruido")
    }
}
