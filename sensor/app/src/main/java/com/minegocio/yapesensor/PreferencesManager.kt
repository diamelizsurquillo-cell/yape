package com.minegocio.yapesensor

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import java.util.UUID

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "yape_sensor_settings")

class PreferencesManager(private val context: Context) {

    companion object {
        private val BACKEND_URL_KEY = stringPreferencesKey("backend_url")
        private val API_KEY_KEY = stringPreferencesKey("api_key")
        private val DISPOSITIVO_ID_KEY = stringPreferencesKey("dispositivo_id")
    }

    val backendUrl: Flow<String> = context.dataStore.data.map { preferences ->
        preferences[BACKEND_URL_KEY] ?: ""
    }

    val apiKey: Flow<String> = context.dataStore.data.map { preferences ->
        preferences[API_KEY_KEY] ?: ""
    }

    val dispositivoId: Flow<String> = context.dataStore.data.map { preferences ->
        var id = preferences[DISPOSITIVO_ID_KEY]
        if (id.isNullOrEmpty()) {
            id = UUID.randomUUID().toString()
            // Se guardará de manera asíncrona pero se retorna aquí
            saveDispositivoIdSync(id)
        }
        id
    }

    suspend fun saveSettings(url: String, key: String) {
        context.dataStore.edit { preferences ->
            preferences[BACKEND_URL_KEY] = url
            preferences[API_KEY_KEY] = key
        }
    }

    private fun saveDispositivoIdSync(id: String) {
        // Ejecutar en una corrutina global de forma segura
        @Suppress("OPT_IN_USAGE")
        GlobalScope.launch {
            context.dataStore.edit { preferences ->
                preferences[DISPOSITIVO_ID_KEY] = id
            }
        }
    }

    suspend fun getBackendUrl(): String = backendUrl.first()
    suspend fun getApiKey(): String = apiKey.first()
    suspend fun getDispositivoId(): String = dispositivoId.first()
}
