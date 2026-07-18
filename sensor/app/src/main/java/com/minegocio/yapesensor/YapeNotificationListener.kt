package com.minegocio.yapesensor

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
        // Paquete de la aplicación Yape (fácil de editar si cambia)
        const val YAPE_PACKAGE_NAME = "com.bcp.innovacxion.yapeapp"
        private const val TAG = "YapeNotificationListener"
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO)
    private lateinit var repository: PaymentRepository
    private lateinit var preferences: PreferencesManager

    override fun onCreate() {
        super.onCreate()
        repository = PaymentRepository(applicationContext)
        preferences = PreferencesManager(applicationContext)
        Log.i(TAG, "Yape Notification Listener Service Creado")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val packageName = sbn.packageName
        if (packageName != YAPE_PACKAGE_NAME) {
            return
        }

        val extras = sbn.notification.extras
        val title = extras.getString(NotificationCompat.EXTRA_TITLE)
        val text = extras.getString(NotificationCompat.EXTRA_TEXT) ?: extras.getCharSequence(NotificationCompat.EXTRA_TEXT)?.toString()
        val timestamp = sbn.postTime

        Log.d(TAG, "Notificación de Yape detectada -> Título: $title, Texto: $text, Timestamp: $timestamp")

        val parsed = YapeNotificationParser.parse(title, text, timestamp)
        if (parsed != null) {
            Log.i(TAG, "Pago procesado exitosamente -> Remitente: ${parsed.remitente}, Monto: ${parsed.monto}")
            serviceScope.launch {
                repository.saveAndUploadPayment(
                    remitente = parsed.remitente,
                    monto = parsed.monto,
                    timestamp = parsed.timestamp,
                    codigoSeguridad = parsed.codigoSeguridad
                )
            }
        } else {
            Log.d(TAG, "La notificación no corresponde a un formato de pago procesable.")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
        Log.i(TAG, "Yape Notification Listener Service Destruido")
    }
}
