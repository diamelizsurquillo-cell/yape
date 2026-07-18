package com.minegocio.yapesensor

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var preferencesManager: PreferencesManager
    private lateinit var repository: PaymentRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        preferencesManager = PreferencesManager(applicationContext)
        repository = PaymentRepository(applicationContext)

        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    SensorSettingsScreen(
                        preferencesManager = preferencesManager,
                        repository = repository,
                        checkPermission = { isNotificationServiceEnabled(this) },
                        openSettings = { openNotificationSettings() },
                        openAppDetails = { openAppDetailsSettings() },
                        checkBatteryOptimizations = { isBatteryOptimizationIgnored(this) },
                        requestBatteryOptimizations = { requestIgnoreBatteryOptimization() }
                    )
                }
            }
        }
    }

    private fun isNotificationServiceEnabled(context: Context): Boolean {
        val pkgName = context.packageName
        val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
        if (!flat.isNullOrEmpty()) {
            val names = flat.split(":")
            for (name in names) {
                val cn = ComponentName.unflattenFromString(name)
                if (cn != null && cn.packageName == pkgName) {
                    return true
                }
            }
        }
        return false
    }

    private fun openNotificationSettings() {
        try {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "No se pudo abrir la configuración de notificaciones", Toast.LENGTH_LONG).show()
        }
    }

    private fun openAppDetailsSettings() {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
            }
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "No se pudo abrir los detalles de la aplicación", Toast.LENGTH_LONG).show()
        }
    }

    private fun isBatteryOptimizationIgnored(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    private fun requestIgnoreBatteryOptimization() {
        try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.fromParts("package", packageName, null)
            }
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "No se pudo solicitar la exclusión de batería", Toast.LENGTH_LONG).show()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SensorSettingsScreen(
    preferencesManager: PreferencesManager,
    repository: PaymentRepository,
    checkPermission: () -> Boolean,
    openSettings: () -> Unit,
    openAppDetails: () -> Unit,
    checkBatteryOptimizations: () -> Boolean,
    requestBatteryOptimizations: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var isPermissionGranted by remember { mutableStateOf(false) }
    var isBatteryIgnored by remember { mutableStateOf(false) }

    val savedUrl by preferencesManager.backendUrl.collectAsState(initial = "")
    val savedApiKey by preferencesManager.apiKey.collectAsState(initial = "")
    val dispositivoId by preferencesManager.dispositivoId.collectAsState(initial = "Generando...")

    var urlInput by remember { mutableStateOf("") }
    var apiKeyInput by remember { mutableStateOf("") }

    // Sincronizar campos al cargar los datos guardados
    LaunchedEffect(savedUrl, savedApiKey) {
        urlInput = savedUrl
        apiKeyInput = savedApiKey
    }

    // Verificar permisos periódicamente cuando la pantalla se enfoca
    LaunchedEffect(Unit) {
        isPermissionGranted = checkPermission()
        isBatteryIgnored = checkBatteryOptimizations()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Yape Sensor - Ajustes", fontWeight = FontWeight.Bold, color = Color.White) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF740099) // Color morado característico
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Card de Estado del Permiso de Notificaciones
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = if (isPermissionGranted) Color(0xFFE8F5E9) else Color(0xFFFFEBEE)
                )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = if (isPermissionGranted) "LECTOR DE NOTIFICACIONES ACTIVO" else "ACCESO A NOTIFICACIONES REQUERIDO",
                        fontWeight = FontWeight.Bold,
                        color = if (isPermissionGranted) Color(0xFF2E7D32) else Color(0xFFC62828),
                        fontSize = 15.sp
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = if (isPermissionGranted)
                            "El sensor está escuchando las notificaciones de Yape y las transmitirá al servidor."
                        else
                            "Para que la aplicación funcione, debes otorgarle acceso a las notificaciones en el sistema Android.",
                        fontSize = 13.sp,
                        color = Color.DarkGray
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = {
                                openSettings()
                                scope.launch {
                                    kotlinx.coroutines.delay(1000)
                                    isPermissionGranted = checkPermission()
                                }
                            },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF740099))
                        ) {
                            Text(if (isPermissionGranted) "Re-activar Permiso" else "Activar Lector", color = Color.White, fontSize = 12.sp)
                        }

                        // Botón para abrir los detalles de la app en caso de estar bloqueado por ajustes restringidos
                        OutlinedButton(
                            onClick = { openAppDetails() },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Detalles de App", fontSize = 12.sp)
                        }
                    }
                }
            }

            // Card de Estado de la Batería (Segundo Plano)
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = if (isBatteryIgnored) Color(0xFFE8F5E9) else Color(0xFFFFF9C4)
                )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = if (isBatteryIgnored) "OPTIMIZACIÓN DE BATERÍA EXCLUIDA" else "OPTIMIZACIÓN DE BATERÍA DETECTADA",
                        fontWeight = FontWeight.Bold,
                        color = if (isBatteryIgnored) Color(0xFF2E7D32) else Color(0xFFF57F17),
                        fontSize = 15.sp
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = if (isBatteryIgnored)
                            "La app puede correr ilimitadamente en segundo plano sin ser cerrada por el sistema."
                        else
                            "Xiaomi podría cerrar la app si pasa mucho tiempo inactiva. Activa el modo 'Sin Restricciones'.",
                        fontSize = 13.sp,
                        color = Color.DarkGray
                    )
                    if (!isBatteryIgnored) {
                        Spacer(modifier = Modifier.height(10.dp))
                        Button(
                            onClick = {
                                requestBatteryOptimizations()
                                scope.launch {
                                    kotlinx.coroutines.delay(1000)
                                    isBatteryIgnored = checkBatteryOptimizations()
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF57F17))
                        ) {
                            Text("Permitir en Segundo Plano", color = Color.White, fontSize = 12.sp)
                        }
                    }
                }
            }

            // Card de Identificación de Dispositivo
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("ID del Dispositivo", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        Text(dispositivoId, fontSize = 11.sp, color = Color.Gray)
                    }
                }
            }

            // Formulario de Ajustes
            OutlinedTextField(
                value = urlInput,
                onValueChange = { urlInput = it },
                label = { Text("URL del Backend (POST /api/pagos)") },
                placeholder = { Text("https://mi-servidor.com") },
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                singleLine = true
            )

            OutlinedTextField(
                value = apiKeyInput,
                onValueChange = { apiKeyInput = it },
                label = { Text("API Key / Token de Seguridad") },
                placeholder = { Text("Introduce tu clave de seguridad") },
                modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Botones de Acción
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = {
                        scope.launch {
                            preferencesManager.saveSettings(urlInput, apiKeyInput)
                            Toast.makeText(context, "Configuración guardada", Toast.LENGTH_SHORT).show()
                            isPermissionGranted = checkPermission()
                            isBatteryIgnored = checkBatteryOptimizations()
                        }
                    },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF740099))
                ) {
                    Text("Guardar", color = Color.White)
                }

                OutlinedButton(
                    onClick = {
                        scope.launch {
                            // Enviar pago dummy de prueba
                            repository.saveAndUploadPayment(
                                remitente = "PAGO DE PRUEBA YAPE",
                                monto = 1.0,
                                timestamp = System.currentTimeMillis(),
                                codigoSeguridad = "999"
                            )
                            Toast.makeText(context, "Pago de prueba enviado", Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Test Conexión")
                }
            }
        }
    }
}
