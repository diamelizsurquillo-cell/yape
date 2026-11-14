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
        private const val ENCRYPTED_PREFS_NAME = "yape_sensor_secure_v2"
        private const val KEY_BACKEND_URL = "backend_url"
        private const val KEY_API_KEY = "api_key"
        private const val KEY_HMAC_SECRET = "hmac_secret"
        private const val KEY_BUSINESS_NAME = "nombre_comercial"
        private const val KEY_DEVICE_ID = "dispositivo_id"

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
                // Fallback seguro en caso de hardware Keystore corrupto en ciertos emuladores
                appContext.getSharedPreferences(ENCRYPTED_PREFS_NAME + "_fallback", Context.MODE_PRIVATE)
            }
        }
    }

    private val prefs = getSecurePrefs(context.applicationContext)

    private val _backendUrl = MutableStateFlow(prefs.getString(KEY_BACKEND_URL, DEFAULT_CLOUD_URL) ?: DEFAULT_CLOUD_URL)
    private val _apiKey = MutableStateFlow(prefs.getString(KEY_API_KEY, "") ?: "")
    private val _businessName = MutableStateFlow(prefs.getString(KEY_BUSINESS_NAME, "") ?: "")
    private val _dispositivoId = MutableStateFlow(getOrCreateDeviceId())

    val backendUrl: Flow<String> = _backendUrl.asStateFlow()
    val apiKey: Flow<String> = _apiKey.asStateFlow()
    val businessName: Flow<String> = _businessName.asStateFlow()
    val dispositivoId: Flow<String> = _dispositivoId.asStateFlow()

    private fun getOrCreateDeviceId(): String {
        var id = prefs.getString(KEY_DEVICE_ID, null)
        if (id.isNullOrBlank()) {
            id = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, id).apply()
        }
        return id
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

    fun updateHmacSecretIfProvided(hmacSecret: String?) {
        if (!hmacSecret.isNullOrBlank()) {
            prefs.edit().putString(KEY_HMAC_SECRET, hmacSecret.trim()).apply()
        }
    }

    fun getBackendUrl(): String = prefs.getString(KEY_BACKEND_URL, DEFAULT_CLOUD_URL) ?: DEFAULT_CLOUD_URL
    fun getApiKey(): String = prefs.getString(KEY_API_KEY, "") ?: ""
    fun getHmacSecret(): String = prefs.getString(KEY_HMAC_SECRET, "") ?: ""
    fun getBusinessName(): String = prefs.getString(KEY_BUSINESS_NAME, "") ?: ""
    fun getDispositivoId(): String = getOrCreateDeviceId()
}
