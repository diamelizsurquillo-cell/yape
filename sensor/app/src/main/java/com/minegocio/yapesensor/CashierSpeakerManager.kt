package com.minegocio.yapesensor

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.app.NotificationCompat
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Altavoz Nativo de Caja (Funciona incluso con pantalla completamente apagada en el bolsillo).
 * Usa TextToSpeech nativo de Android + WakeLock temporal + Notificación en pantalla de bloqueo.
 */
class CashierSpeakerManager(context: Context) {

    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val powerManager = appContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    private val notificationManager =
        appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    @Volatile
    private var ttsReady = false
    private var tts: TextToSpeech? = null
    private var focusRequest: AudioFocusRequest? = null

    companion object {
        private const val ALERT_CHANNEL_ID = "yape_cashier_speaker_alerts_v1"
    }

    init {
        createAlertChannel()
        initTts()
    }

    private fun initTts() {
        try {
            tts = TextToSpeech(appContext) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    val engine = tts ?: return@TextToSpeech
                    val locales = listOf(
                        Locale("es", "PE"),
                        Locale("es", "ES"),
                        Locale("es", "US"),
                        Locale("es")
                    )
                    for (loc in locales) {
                        val res = engine.setLanguage(loc)
                        if (res != TextToSpeech.LANG_MISSING_DATA && res != TextToSpeech.LANG_NOT_SUPPORTED) {
                            break
                        }
                    }
                    engine.setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    engine.setSpeechRate(1.0f)
                    engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(utteranceId: String?) {}
                        override fun onDone(utteranceId: String?) {
                            abandonAudioFocus()
                        }
                        @Deprecated("Deprecated in Java")
                        override fun onError(utteranceId: String?) {
                            abandonAudioFocus()
                        }
                    })
                    ttsReady = true
                }
            }
        } catch (e: Exception) {
            DiagnosticLogger.log("⚠️ No se pudo iniciar sintetizador de voz: ${e.message}")
        }
    }

    private fun requestAudioFocus() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    .build()
                focusRequest = req
                audioManager.requestAudioFocus(req)
            } else {
                @Suppress("DEPRECATION")
                audioManager.requestAudioFocus(
                    null,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
                )
            }
        } catch (_: Exception) {
        }
    }

    private fun abandonAudioFocus() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            }
        } catch (_: Exception) {
        }
    }

    fun announcePayment(
        banco: String,
        monto: Double,
        remitente: String,
        codigoSeguridad: String?,
        includeSender: Boolean,
        showNotification: Boolean = true
    ) {
        val wakeLock = try {
            powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "YapeSensor::SpeakerAnnounceLock"
            ).apply { acquire(12_000L) }
        } catch (_: Exception) {
            null
        }

        val cleanBank = banco.ifBlank { "YAPE" }.uppercase(Locale.US)
        val enteros = monto.toInt()
        val centimos = ((monto - enteros) * 100.0).roundToInt()

        val montoTexto = if (centimos > 0) {
            "$enteros soles con $centimos céntimos"
        } else {
            "$enteros ${if (enteros == 1) "sol" else "soles"}"
        }

        val senderPart = if (includeSender && remitente.isNotBlank()) {
            ", de $remitente"
        } else {
            ""
        }

        val codeDigits = codigoSeguridad?.trim().orEmpty()
        val codePart = if (codeDigits.isNotEmpty() && codeDigits != "BBVA") {
            ". Código ${codeDigits.toCharArray().joinToString(" ")}"
        } else {
            ""
        }

        val speechText = "Atención. Pago $cleanBank recibido de $montoTexto$senderPart$codePart."
        DiagnosticLogger.log("🔊 Voz Altavoz: $cleanBank S/ ${String.format(Locale.US, "%.2f", monto)} ($remitente)")

        if (showNotification) {
            postLockScreenNotification(cleanBank, monto, remitente, codeDigits)
        }

        if (ttsReady && tts != null) {
            requestAudioFocus()
            tts?.speak(
                speechText,
                TextToSpeech.QUEUE_ADD,
                null,
                "pago_${System.currentTimeMillis()}"
            )
        } else {
            initTts()
        }

        if (wakeLock?.isHeld == true) {
            // Se libera automáticamente tras máximo 12s por acquire(timeout)
        }
    }

    private fun postLockScreenNotification(
        banco: String,
        monto: Double,
        remitente: String,
        codigo: String
    ) {
        try {
            val openIntent = Intent(appContext, MainActivity::class.java)
            val pendingIntent = PendingIntent.getActivity(
                appContext,
                201,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val codLabel = if (codigo.isNotBlank()) " • Cód: $codigo" else ""
            val notification = NotificationCompat.Builder(appContext, ALERT_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("💸 $banco S/ ${String.format(Locale.US, "%.2f", monto)}")
                .setContentText("De: $remitente$codLabel")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build()

            notificationManager.notify((System.currentTimeMillis() % 100000).toInt(), notification)
        } catch (_: Exception) {
        }
    }

    private fun createAlertChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                ALERT_CHANNEL_ID,
                "Alertas de Pagos en Caja",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Muestra pagos recibidos en la pantalla de bloqueo del cajero"
                enableVibration(true)
            }
            notificationManager.createNotificationChannel(channel)
        }
    }

    fun shutdown() {
        try {
            tts?.stop()
            tts?.shutdown()
        } catch (_: Exception) {
        }
    }
}
