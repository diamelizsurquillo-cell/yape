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

        // SEC-02: Lista Blanca estricta de paquetes bancarios oficiales del Perú (Antifraude WhatsApp/SMS)
        private val OFFICIAL_BANK_PACKAGES = setOf(
            "com.bcp.innovacxion.yapeapp",           // Yape Oficial
            "com.bcp.bank.bcp",                      // Banca Móvil BCP
            "com.bbva.nxt_peru",                     // BBVA Perú
            "com.bbva.continental",                  // BBVA Continental
            "com.bbva.netcash",                      // BBVA Empresas Net Cash
            "pe.com.interbank.mobilebanking",        // Interbank (Plin)
            "pe.com.interbank.mpay",                 // IzipayYA / Interbank Plin
            "pe.indigital.tunki",                    // Tunki / IzipayYA (Plin)
            "pe.com.scotiabank.blpm.android.client", // Scotiabank Perú (Plin)
            "com.banbif.bancamovil",                 // BanBif (Plin)
            "pe.com.cajapiura.app",                  // Caja Piura
            "pe.com.cajaarequipa.movil",             // Caja Arequipa
            "pe.com.cmacica.movil",                  // Caja Ica
            "pe.com.cajatrujillo.movil",             // Caja Trujillo
            "pe.com.cajahuancayo.app",               // Caja Huancayo
            "pe.com.cajacusco.movil"                 // Caja Cusco
        )

        private val MESSAGING_OR_SOCIAL_PACKAGES = setOf(
            "com.whatsapp",
            "com.whatsapp.w4b",
            "org.telegram.messenger",
            "org.thunderdog.challegram",
            "com.google.android.apps.messaging",
            "com.samsung.android.messaging",
            "com.android.mms",
            "com.facebook.orca",
            "com.facebook.katana",
            "com.instagram.android",
            "com.zhiliaoapp.musically",
            "com.google.android.gm",
            "com.microsoft.office.outlook"
        )

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
        if (sbn == null || sbn.isOngoing) return

        val packageName = (sbn.packageName ?: "").trim()
        val normalizedPkg = packageName.lowercase()
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
        val combinedSearchText = "$title $text".lowercase()

        // SEC-02: Bloqueo antifraude estricto. Jamás aceptar notificaciones de WhatsApp, SMS, Telegram, etc.
        if (!OFFICIAL_BANK_PACKAGES.contains(normalizedPkg)) {
            if (MESSAGING_OR_SOCIAL_PACKAGES.contains(normalizedPkg) &&
                (combinedSearchText.contains("te yape") ||
                 combinedSearchText.contains("cód. de seguridad") ||
                 combinedSearchText.contains("cod. de seguridad") ||
                 combinedSearchText.contains("te pline"))
            ) {
                DiagnosticLogger.log("🛡️ ALERTA ANTIFRAUDE: Intento de pago falso bloqueado desde app no bancaria [$packageName]")
            }
            return
        }

        val hasPaymentKeywords = combinedSearchText.contains("s/") ||
                combinedSearchText.contains("yape") ||
                combinedSearchText.contains("plin") ||
                combinedSearchText.contains("bbva") ||
                combinedSearchText.contains("cobro con qr") ||
                combinedSearchText.contains("te envió") ||
                combinedSearchText.contains("te envio") ||
                combinedSearchText.contains("te hizo un pago") ||
                combinedSearchText.contains("te transfiri") ||
                combinedSearchText.contains("recibiste") ||
                combinedSearchText.contains("has recibido") ||
                combinedSearchText.contains("pago recibido") ||
                combinedSearchText.contains("confirmación de pago") ||
                combinedSearchText.contains("confirmacion de pago")

        if (!hasPaymentKeywords) {
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
