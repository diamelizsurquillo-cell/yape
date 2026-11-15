package com.minegocio.yapesensor

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

class PreferencesManager(context: Context) {

    companion object {
        const val DEFAULT_CLOUD_URL = "https://yape-orcin.vercel.app"
        const val MODE_SENSOR = "SENSOR"
        const val MODE_SPEAKER = "SPEAKER"

        private const val ENCRYPTED_PREFS_NAME = "yape_sensor_secure_v2"
        private const val KEY_BACKEND_URL = "backend_url"
        private const val KEY_API_KEY = "api_key"
        private const val KEY_HMAC_SECRET = "hmac_secret"
        private const val KEY_BUSINESS_NAME = "nombre_comercial"
        private const val KEY_DEVICE_ID = "dispositivo_id"

        // Modo Parlante de Caja (Voz con Pantalla Apagada)
        private const val KEY_APP_MODE = "app_mode"
        private const val KEY_SPEAKER_TOKEN = "speaker_jwt_token"
        private const val KEY_SPEAKER_USERNAME = "speaker_username"
        private const val KEY_SPEAKER_PASS = "speaker_password_enc"
        private const val KEY_SPEAKER_INCLUDE_SENDER = "speaker_include_sender"
        private const val KEY_LAST_SPOKEN_ID = "speaker_last_spoken_id"

        @Volatile
        private var securePrefsInstance: SharedPreferences? = null

        private fun getSecurePrefs(appContext: Context): SharedPreferences {
            return securePrefsInstance ?: synchronized(this) {
                securePrefsInstance ?: createEncryptedPrefs(appContext).also {
                    securePrefsInstance = it
                }
            }
        }

        private fun createEncryptedPrefs(appContext: Context): SharedPreferences {
            return try {
                val masterKey = MasterKey.Builder(appContext)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
                EncryptedSharedPreferences.create(
                    appContext,
                    ENCRYPTED_PREFS_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                )
            } catch (_: Exception) {
                appContext.getSharedPreferences(ENCRYPTED_PREFS_NAME + "_fallback", Context.MODE_PRIVATE)
            }
        }
    }

    private val prefs = getSecurePrefs(context.applicationContext)

    private val _backendUrl = MutableStateFlow(prefs.getString(KEY_BACKEND_URL, DEFAULT_CLOUD_URL) ?: DEFAULT_CLOUD_URL)
    private val _apiKey = MutableStateFlow(prefs.getString(KEY_API_KEY, "") ?: "")
    private val _businessName = MutableStateFlow(prefs.getString(KEY_BUSINESS_NAME, "") ?: "")
    private val _dispositivoId = MutableStateFlow(getOrCreateDeviceId())
    private val _appMode = MutableStateFlow(prefs.getString(KEY_APP_MODE, MODE_SENSOR) ?: MODE_SENSOR)
    private val _speakerToken = MutableStateFlow(prefs.getString(KEY_SPEAKER_TOKEN, "") ?: "")
    private val _speakerUsername = MutableStateFlow(prefs.getString(KEY_SPEAKER_USERNAME, "") ?: "")
    private val _speakerIncludeSender = MutableStateFlow(prefs.getBoolean(KEY_SPEAKER_INCLUDE_SENDER, true))

    val backendUrl: Flow<String> = _backendUrl.asStateFlow()
    val apiKey: Flow<String> = _apiKey.asStateFlow()
    val businessName: Flow<String> = _businessName.asStateFlow()
    val dispositivoId: Flow<String> = _dispositivoId.asStateFlow()
    val appMode: Flow<String> = _appMode.asStateFlow()
    val speakerToken: Flow<String> = _speakerToken.asStateFlow()
    val speakerUsername: Flow<String> = _speakerUsername.asStateFlow()
    val speakerIncludeSender: Flow<Boolean> = _speakerIncludeSender.asStateFlow()

    private fun getOrCreateDeviceId(): String {
        var id = prefs.getString(KEY_DEVICE_ID, null)
        if (id.isNullOrBlank()) {
            id = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, id).apply()
        }
        return id
    }

    fun setAppMode(mode: String) {
        val clean = if (mode == MODE_SPEAKER) MODE_SPEAKER else MODE_SENSOR
        prefs.edit().putString(KEY_APP_MODE, clean).apply()
        _appMode.value = clean
    }

    fun saveSettings(url: String, key: String, hmacSecret: String? = null, businessName: String? = null) {
        val normalizedUrl = NetworkClient.normalizeBaseUrl(url.ifBlank { DEFAULT_CLOUD_URL })
        val cleanKey = key.trim()
        val editor = prefs.edit()
            .putString(KEY_BACKEND_URL, normalizedUrl)
            .putString(KEY_API_KEY, cleanKey)

        if (hmacSecret != null) {
            editor.putString(KEY_HMAC_SECRET, hmacSecret.trim())
        }
        if (businessName != null) {
            editor.putString(KEY_BUSINESS_NAME, businessName.trim())
            _businessName.value = businessName.trim()
        }
        editor.apply()

        _backendUrl.value = normalizedUrl
        _apiKey.value = cleanKey
    }

    fun saveSpeakerSession(
        url: String,
        token: String,
        username: String,
        passwordRaw: String,
        businessName: String
    ) {
        val normalizedUrl = NetworkClient.normalizeBaseUrl(url.ifBlank { DEFAULT_CLOUD_URL })
        prefs.edit()
            .putString(KEY_BACKEND_URL, normalizedUrl)
            .putString(KEY_SPEAKER_TOKEN, token.trim())
            .putString(KEY_SPEAKER_USERNAME, username.trim())
            .putString(KEY_SPEAKER_PASS, passwordRaw)
            .putString(KEY_BUSINESS_NAME, businessName.trim())
            .putString(KEY_APP_MODE, MODE_SPEAKER)
            .apply()

        _backendUrl.value = normalizedUrl
        _speakerToken.value = token.trim()
        _speakerUsername.value = username.trim()
        _businessName.value = businessName.trim()
        _appMode.value = MODE_SPEAKER
    }

    fun clearSpeakerSession() {
        prefs.edit()
            .remove(KEY_SPEAKER_TOKEN)
            .remove(KEY_SPEAKER_USERNAME)
            .remove(KEY_SPEAKER_PASS)
            .remove(KEY_LAST_SPOKEN_ID)
            .apply()
        _speakerToken.value = ""
        _speakerUsername.value = ""
    }

    fun setSpeakerIncludeSender(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_SPEAKER_INCLUDE_SENDER, enabled).apply()
        _speakerIncludeSender.value = enabled
    }

    fun getLastSpokenId(): Long = prefs.getLong(KEY_LAST_SPOKEN_ID, 0L)
    fun setLastSpokenId(id: Long) {
        prefs.edit().putLong(KEY_LAST_SPOKEN_ID, id).apply()
    }

    fun updateHmacSecretIfProvided(hmacSecret: String?) {
        if (!hmacSecret.isNullOrBlank()) {
            prefs.edit().putString(KEY_HMAC_SECRET, hmacSecret.trim()).apply()
        }
    }

    fun getBackendUrl(): String = prefs.getString(KEY_BACKEND_URL, DEFAULT_CLOUD_URL) ?: DEFAULT_CLOUD_URL
    fun getApiKey(): String = prefs.getString(KEY_API_KEY, "") ?: ""
    fun getHmacSecret(): String = prefs.getString(KEY_HMAC_SECRET, "") ?: ""
    fun getBusinessName(): String = prefs.getString(KEY_BUSINESS_NAME, "") ?: ""
    fun getSpeakerToken(): String = prefs.getString(KEY_SPEAKER_TOKEN, "") ?: ""
    fun getSpeakerUsername(): String = prefs.getString(KEY_SPEAKER_USERNAME, "") ?: ""
    fun getSpeakerPassword(): String = prefs.getString(KEY_SPEAKER_PASS, "") ?: ""
    fun getSpeakerIncludeSender(): Boolean = prefs.getBoolean(KEY_SPEAKER_INCLUDE_SENDER, true)
    fun hasActiveBackgroundWork(): Boolean = getApiKey().isNotBlank() || getSpeakerToken().isNotBlank()
    fun getDispositivoId(): String = getOrCreateDeviceId()
}
