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
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.text.font.FontFamily
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
        
        rebindNotificationListener()

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
                        requestBatteryOptimizations = { requestIgnoreBatteryOptimization() },
                        rebindService = { rebindNotificationListener() }
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        rebindNotificationListener()
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

    private fun rebindNotificationListener() {
        YapeNotificationListener.tryRebind(this)
    }

    private fun openNotificationSettings() {
        rebindNotificationListener()
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
    requestBatteryOptimizations: () -> Unit,
    rebindService: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()

    var isPermissionGranted by remember { mutableStateOf(false) }
    var isBatteryIgnored by remember { mutableStateOf(false) }

    val savedUrl by preferencesManager.backendUrl.collectAsState(initial = "")
    val savedApiKey by preferencesManager.apiKey.collectAsState(initial = "")
    val dispositivoId by preferencesManager.dispositivoId.collectAsState(initial = "Generando...")
    
    val liveLogs by DiagnosticLogger.logs.collectAsState()
    val isServiceConnected by DiagnosticLogger.isServiceConnected.collectAsState()

    var urlInput by remember { mutableStateOf("") }
    var apiKeyInput by remember { mutableStateOf("") }

    LaunchedEffect(savedUrl, savedApiKey) {
        urlInput = savedUrl
        apiKeyInput = savedApiKey
    }

    LaunchedEffect(Unit) {
        isPermissionGranted = checkPermission()
        isBatteryIgnored = checkBatteryOptimizations()
        rebindService()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Yape Sensor - Monitor Activo", fontWeight = FontWeight.Bold, color = Color.White) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF740099)
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(scrollState)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
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
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = if (isPermissionGranted)
                            if (isServiceConnected) "🟢 Servicio conectado y escuchando notificaciones de Yape."
                            else "🟡 Permiso otorgado. Si no detecta, presiona 'Re-activar' para reconectar."
                        else
                            "Debes otorgarle acceso a las notificaciones en el sistema Android.",
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
                                rebindService()
                                openSettings()
                                scope.launch {
                                    kotlinx.coroutines.delay(1000)
                                    isPermissionGranted = checkPermission()
                                    rebindService()
                                }
                            },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF740099))
                        ) {
                            Text(if (isPermissionGranted) "Re-activar Permiso" else "Activar Lector", color = Color.White, fontSize = 12.sp)
                        }

                        OutlinedButton(
                            onClick = { openAppDetails() },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Detalles de App", fontSize = 12.sp)
                        }
                    }
                }
            }

            // Card de Estado de la Batería
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = if (isBatteryIgnored) Color(0xFFE8F5E9) else Color(0xFFFFF9C4)
                )
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = if (isBatteryIgnored) "OPTIMIZACIÓN DE BATERÍA EXCLUIDA" else "OPTIMIZACIÓN DE BATERÍA DETECTADA",
                        fontWeight = FontWeight.Bold,
                        color = if (isBatteryIgnored) Color(0xFF2E7D32) else Color(0xFFF57F17),
                        fontSize = 14.sp
                    )
                    if (!isBatteryIgnored) {
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "Xiaomi podría cerrar el sensor. Activa el modo 'Sin Restricciones'.",
                            fontSize = 12.sp,
                            color = Color.DarkGray
                        )
                        Spacer(modifier = Modifier.height(8.dp))
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

            // Formulario de Ajustes
            OutlinedTextField(
                value = urlInput,
                onValueChange = { urlInput = it },
                label = { Text("URL del Backend (POST /api/pagos)") },
                placeholder = { Text("https://mi-servidor.vercel.app") },
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
                            rebindService()
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
                            DiagnosticLogger.log("🧪 Enviando pago de prueba manual...")
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

            // Card de Consola de Diagnóstico en Vivo
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1E1E1E))
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "📋 REGISTRO EN VIVO (DIAGNÓSTICO)",
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF81C784),
                            fontSize = 12.sp
                        )
                        OutlinedButton(
                            onClick = { DiagnosticLogger.clear() },
                            modifier = Modifier.height(28.dp)
                        ) {
                            Text("Limpiar", color = Color.White, fontSize = 10.sp)
                        }
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(180.dp)
                            .background(Color(0xFF121212), RoundedCornerShape(4.dp))
                            .padding(8.dp)
                    ) {
                        if (liveLogs.isEmpty()) {
                            Text(
                                text = "Esperando notificaciones de Yape...\n(Cuando llegue un Yape o hagas un Test, verás aquí el paso a paso en tiempo real)",
                                color = Color.Gray,
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace
                            )
                        } else {
                            val scrollLogs = rememberScrollState()
                            Column(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .verticalScroll(scrollLogs)
                            ) {
                                liveLogs.forEach { logLine ->
                                    Text(
                                        text = logLine,
                                        color = if (logLine.contains("ERROR") || logLine.contains("❌") || logLine.contains("⚠️")) Color(0xFFFF8A80)
                                                else if (logLine.contains("ÉXITO") || logLine.contains("✅") || logLine.contains("💰")) Color(0xFFB9F6CA)
                                                else Color(0xFFE0E0E0),
                                        fontSize = 10.sp,
                                        fontFamily = FontFamily.Monospace,
                                        lineHeight = 14.sp
                                    )
                                    Spacer(modifier = Modifier.height(3.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
