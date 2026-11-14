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
 * Servicio Persistente Anti-Cierre (Xiaomi MIUI / HyperOS, Samsung OneUI, Motorola, Honor).
 * Mantiene vivo el proceso lector cuando la pantalla está apagada y envía el pulso de batería cada 60s.
 */
class SensorKeepAliveService : Service() {

    companion object {
        private const val CHANNEL_ID = "yape_sensor_keepalive_v2"
        private const val NOTIFICATION_ID = 7401

        fun start(context: Context) {
            try {
                val intent = Intent(context, SensorKeepAliveService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (_: Exception) {
                // Ignorar en caso de restricción de arranque de Android 14 desde contexto sin permiso aún
            }
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var repository: PaymentRepository
    private lateinit var prefs: PreferencesManager

    override fun onCreate() {
        super.onCreate()
        repository = PaymentRepository(applicationContext)
        prefs = PreferencesManager(applicationContext)
        createChannel()
        val notification = buildForegroundNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        serviceScope.launch {
            while (isActive) {
                if (!DiagnosticLogger.isServiceConnected.value) {
                    YapeNotificationListener.tryRebind(applicationContext)
                }
                repository.sendHeartbeat()
                repository.triggerUpload()
                delay(60_000L)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        updateForegroundText()
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
        val subtitle = if (biz.isNotBlank()) {
            "Conectado a $biz • Escuchando Yape / Plin / BBVA"
        } else {
            "Protección activa en segundo plano"
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle("Sensor Antifraude Activo")
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
                "Protección Continua Yape Sensor",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Mantiene activo el detector de pagos cuando la pantalla está apagada"
                setShowBadge(false)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
