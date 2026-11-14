package com.minegocio.yapesensor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Reactiva automáticamente el sensor de pagos cuando el celular se enciende o la app se actualiza.
 */
class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            val prefs = PreferencesManager(context)
            if (prefs.getApiKey().isNotBlank()) {
                SensorKeepAliveService.start(context)
                YapeNotificationListener.tryRebind(context)
            }
        }
    }
}
