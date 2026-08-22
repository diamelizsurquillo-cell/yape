package com.minegocio.yapesensor

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object DiagnosticLogger {
    private val _logs = MutableStateFlow<List<String>>(emptyList())
    val logs: StateFlow<List<String>> = _logs.asStateFlow()

    private val _isServiceConnected = MutableStateFlow(false)
    val isServiceConnected: StateFlow<Boolean> = _isServiceConnected.asStateFlow()

    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    fun log(message: String) {
        val time = timeFormat.format(Date())
        val entry = "[$time] $message"
        val current = _logs.value.toMutableList()
        if (current.size >= 50) {
            current.removeAt(current.size - 1)
        }
        current.add(0, entry)
        _logs.value = current
    }

    fun setServiceConnected(connected: Boolean) {
        _isServiceConnected.value = connected
        if (connected) {
            log("✅ Servicio de Notificaciones CONECTADO al sistema Android.")
        } else {
            log("⚠️ Servicio de Notificaciones DESCONECTADO del sistema Android.")
        }
    }

    fun clear() {
        _logs.value = emptyList()
    }
}
