package com.minegocio.yapesensor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Servicio Persistente Anti-Cierre v2.1:
 * 1) MODO SENSOR: mantiene vivo el lector bancario con pantalla apagada y envía pulso/batería cada 60s.
 * 2) MODO PARLANTE CAJA: escucha pagos entrantes cada 3.5s y los canta en voz alta con TextToSpeech
 *    incluso cuando el cajero tiene el celular bloqueado con la pantalla apagada en el bolsillo.
 */
class SensorKeepAliveService : Service() {

    companion object {
        private const val CHANNEL_ID = "yape_sensor_keepalive_v2"
        private const val NOTIFICATION_ID = 7401
        const val ACTION_TEST_SPEAKER = "com.minegocio.yapesensor.ACTION_TEST_SPEAKER"

        fun start(context: Context) {
            try {
                val intent = Intent(context, SensorKeepAliveService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (_: Exception) {
            }
        }

        fun testSpeakerVoice(context: Context) {
            try {
                val intent = Intent(context, SensorKeepAliveService::class.java).apply {
                    action = ACTION_TEST_SPEAKER
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (_: Exception) {
            }
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var repository: PaymentRepository
    private lateinit var prefs: PreferencesManager
    private lateinit var speakerManager: CashierSpeakerManager

    override fun onCreate() {
        super.onCreate()
        repository = PaymentRepository(applicationContext)
        prefs = PreferencesManager(applicationContext)
        speakerManager = CashierSpeakerManager(applicationContext)

        createChannel()
        val notification = buildForegroundNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val fgTypes = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            } else {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            }
            startForeground(NOTIFICATION_ID, notification, fgTypes)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        // Bucle 1: Sensor Receptor del Dueño (Pulso de batería cada 60s)
        serviceScope.launch {
            while (isActive) {
                if (prefs.getApiKey().isNotBlank()) {
                    if (!DiagnosticLogger.isServiceConnected.value) {
                        YapeNotificationListener.tryRebind(applicationContext)
                    }
                    repository.sendHeartbeat()
                    repository.triggerUpload()
                }
                delay(60_000L)
            }
        }

        // Bucle 2: Parlante Nativo de Caja (Voz con Pantalla Apagada cada 3.5s)
        serviceScope.launch {
            var seededBaseline = false
            while (isActive) {
                if (prefs.getSpeakerToken().isNotBlank()) {
                    val list = repository.pollRecentPaymentsForSpeaker()
                    if (list.isNotEmpty()) {
                        val currentMaxId = list.maxOf { it.id }
                        val lastSpoken = prefs.getLastSpokenId()

                        if (!seededBaseline && lastSpoken == 0L) {
                            // Primera sincronización tras login: marcar último pago actual para no repetir historial antiguo
                            prefs.setLastSpokenId(currentMaxId)
                            seededBaseline = true
                        } else {
                            seededBaseline = true
                            val nowSec = System.currentTimeMillis() / 1000
                            val newOnes = list.filter { it.id > lastSpoken && it.timestampSec >= (nowSec - 180) }
                            for (pago in newOnes) {
                                speakerManager.announcePayment(
                                    banco = pago.banco,
                                    monto = pago.monto,
                                    remitente = pago.remitente,
                                    codigoSeguridad = pago.codigoSeguridad,
                                    includeSender = prefs.getSpeakerIncludeSender(),
                                    showNotification = true
                                )
                            }
                            if (currentMaxId > lastSpoken) {
                                prefs.setLastSpokenId(currentMaxId)
                            }
                        }
                    }
                } else {
                    seededBaseline = false
                }
                delay(3_500L)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        updateForegroundText()
        if (intent?.action == ACTION_TEST_SPEAKER) {
            serviceScope.launch {
                delay(400L)
                speakerManager.announcePayment(
                    banco = "YAPE",
                    monto = 35.50,
                    remitente = "Juan Pérez",
                    codigoSeguridad = "482",
                    includeSender = prefs.getSpeakerIncludeSender(),
                    showNotification = true
                )
            }
        }
        return START_STICKY
    }

    private fun updateForegroundText() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildForegroundNotification())
    }

    private fun buildForegroundNotification(): Notification {
        val openIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val biz = prefs.getBusinessName()
        val hasSensor = prefs.getApiKey().isNotBlank()
        val hasSpeaker = prefs.getSpeakerToken().isNotBlank()

        val title = when {
            hasSensor && hasSpeaker -> "Sensor + Parlante de Caja Activos"
            hasSpeaker -> "🔊 Parlante de Caja Activo (Pantalla Apagada OK)"
            else -> "📱 Sensor Antifraude Activo"
        }

        val subtitle = when {
            hasSpeaker && biz.isNotBlank() -> "Cantando pagos en vivo de $biz"
            hasSensor && biz.isNotBlank() -> "Conectado a $biz • Escuchando Yape / Plin / BBVA"
            else -> "Protección continua activa en segundo plano"
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Protección Continua Yape Sensor y Parlante",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Mantiene activo el detector y parlante cuando la pantalla está apagada"
                setShowBadge(false)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        speakerManager.shutdown()
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
