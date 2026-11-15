package com.minegocio.yapesensor

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var preferencesManager: PreferencesManager
    private lateinit var repository: PaymentRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        preferencesManager = PreferencesManager(applicationContext)
        repository = PaymentRepository(applicationContext)

        requestPostNotificationsIfNeeded()
        if (preferencesManager.getApiKey().isNotBlank()) {
            rebindNotificationListener()
        }
        if (preferencesManager.hasActiveBackgroundWork()) {
            SensorKeepAliveService.start(applicationContext)
        }

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
                        rebindService = {
                            if (preferencesManager.getApiKey().isNotBlank()) {
                                rebindNotificationListener()
                            }
                            if (preferencesManager.hasActiveBackgroundWork()) {
                                SensorKeepAliveService.start(applicationContext)
                            }
                        }
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (preferencesManager.getApiKey().isNotBlank()) {
            rebindNotificationListener()
        }
        if (preferencesManager.hasActiveBackgroundWork()) {
            SensorKeepAliveService.start(applicationContext)
        }
    }

    private fun requestPostNotificationsIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    1001
                )
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

    private fun rebindNotificationListener() {
        YapeNotificationListener.tryRebind(this)
    }

    private fun openNotificationSettings() {
        rebindNotificationListener()
        try {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            startActivity(intent)
        } catch (_: Exception) {
            Toast.makeText(this, "No se pudo abrir la configuración de notificaciones", Toast.LENGTH_LONG).show()
        }
    }

    private fun openAppDetailsSettings() {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
            }
            startActivity(intent)
        } catch (_: Exception) {
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
        } catch (_: Exception) {
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
    var showAdvancedManual by remember { mutableStateOf(false) }
    var pairingLoading by remember { mutableStateOf(false) }
    var pairingCodeInput by remember { mutableStateOf("") }

    var speakerLoading by remember { mutableStateOf(false) }
    var speakerUserInput by remember { mutableStateOf("") }
    var speakerPassInput by remember { mutableStateOf("") }

    val activeMode by preferencesManager.appMode.collectAsState(initial = PreferencesManager.MODE_SENSOR)
    val savedUrl by preferencesManager.backendUrl.collectAsState(initial = PreferencesManager.DEFAULT_CLOUD_URL)
    val savedApiKey by preferencesManager.apiKey.collectAsState(initial = "")
    val savedBusinessName by preferencesManager.businessName.collectAsState(initial = "")
    val savedSpeakerToken by preferencesManager.speakerToken.collectAsState(initial = "")
    val savedSpeakerUser by preferencesManager.speakerUsername.collectAsState(initial = "")
    val includeSender by preferencesManager.speakerIncludeSender.collectAsState(initial = true)

    val liveLogs by DiagnosticLogger.logs.collectAsState()
    val isServiceConnected by DiagnosticLogger.isServiceConnected.collectAsState()

    var urlInput by remember { mutableStateOf(PreferencesManager.DEFAULT_CLOUD_URL) }
    var apiKeyInput by remember { mutableStateOf("") }

    LaunchedEffect(savedUrl, savedApiKey, savedSpeakerUser) {
        urlInput = savedUrl.ifBlank { PreferencesManager.DEFAULT_CLOUD_URL }
        apiKeyInput = savedApiKey
        if (speakerUserInput.isBlank() && savedSpeakerUser.isNotBlank()) {
            speakerUserInput = savedSpeakerUser
        }
    }

    LaunchedEffect(Unit) {
        isPermissionGranted = checkPermission()
        isBatteryIgnored = checkBatteryOptimizations()
        rebindService()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Yape Sensor & Parlante v2.1", fontWeight = FontWeight.Bold, color = Color.White, fontSize = 17.sp)
                        if (savedBusinessName.isNotBlank()) {
                            Text("Negocio: $savedBusinessName", color = Color(0xFFE1BEE7), fontSize = 12.sp)
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color(0xFF740099))
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(scrollState)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Selector Dual: MODO SENSOR (Dueño) vs MODO PARLANTE CAJA (Cajero / Bolsillo)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFFEDE7F6), RoundedCornerShape(12.dp))
                    .padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                val isSensorTab = activeMode != PreferencesManager.MODE_SPEAKER
                Button(
                    onClick = { preferencesManager.setAppMode(PreferencesManager.MODE_SENSOR) },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(9.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (isSensorTab) Color(0xFF740099) else Color.Transparent,
                        contentColor = if (isSensorTab) Color.White else Color(0xFF4A148C)
                    )
                ) {
                    Text("📱 Sensor Dueño", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                }

                Button(
                    onClick = { preferencesManager.setAppMode(PreferencesManager.MODE_SPEAKER) },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(9.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (!isSensorTab) Color(0xFF00897B) else Color.Transparent,
                        contentColor = if (!isSensorTab) Color.White else Color(0xFF00695C)
                    )
                ) {
                    Text("🔊 Parlante Caja", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                }
            }

            // Aviso común de Batería Sin Restricciones (garantiza funcionamiento con pantalla apagada)
            if (!isBatteryIgnored) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF9C4))
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "⚡ PERMITIR FUNCIONAR CON PANTALLA APAGADA",
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFFF57F17),
                            fontSize = 13.sp
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Desactiva el ahorro de batería para que Xiaomi / Samsung / Motorola no corte el servicio en tu bolsillo.",
                            fontSize = 12.sp,
                            color = Color.DarkGray
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Button(
                            onClick = {
                                requestBatteryOptimizations()
                                scope.launch {
                                    delay(1200)
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

            if (activeMode == PreferencesManager.MODE_SPEAKER) {
                // =============================================================
                // PESTAÑA 2: MODO PARLANTE CAJA (VOZ CON PANTALLA APAGADA)
                // =============================================================
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFE0F2F1))
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Text(
                            text = if (savedSpeakerToken.isNotBlank())
                                "🔊 PARLANTE CONECTADO (${savedSpeakerUser.uppercase()})"
                            else
                                "🔊 ACTIVAR PARLANTE DE BOLSILLO / CAJA",
                            fontWeight = FontWeight.ExtraBold,
                            color = Color(0xFF00695C),
                            fontSize = 14.sp
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Ingresa tu usuario y contraseña de CAJERO o DUEÑO. Este celular cantará en voz alta cada pago aunque tengas la pantalla bloqueada en el bolsillo (no requiere tener Yape instalado).",
                            fontSize = 12.sp,
                            color = Color.DarkGray
                        )
                        Spacer(modifier = Modifier.height(10.dp))

                        OutlinedTextField(
                            value = speakerUserInput,
                            onValueChange = { speakerUserInput = it },
                            label = { Text("Usuario de Cajero o Dueño") },
                            placeholder = { Text("Ej: polleria_caja") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true
                        )
                        Spacer(modifier = Modifier.height(8.dp))

                        OutlinedTextField(
                            value = speakerPassInput,
                            onValueChange = { speakerPassInput = it },
                            label = { Text("Contraseña") },
                            placeholder = { Text("••••••••") },
                            modifier = Modifier.fillMaxWidth(),
                            visualTransformation = PasswordVisualTransformation(),
                            singleLine = true
                        )

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(top = 4.dp)
                        ) {
                            Checkbox(
                                checked = includeSender,
                                onCheckedChange = { preferencesManager.setSpeakerIncludeSender(it) }
                            )
                            Text("Mencionar nombre del cliente en voz alta", fontSize = 12.sp)
                        }

                        Spacer(modifier = Modifier.height(6.dp))
                        Button(
                            enabled = !speakerLoading && speakerUserInput.isNotBlank() && speakerPassInput.isNotBlank(),
                            onClick = {
                                scope.launch {
                                    speakerLoading = true
                                    val res = repository.loginCashierSpeaker(
                                        serverUrlInput = urlInput,
                                        usernameInput = speakerUserInput,
                                        passwordInput = speakerPassInput
                                    )
                                    speakerLoading = false
                                    if (res.success) {
                                        speakerPassInput = ""
                                        SensorKeepAliveService.start(context)
                                        Toast.makeText(
                                            context,
                                            "¡Parlante activo para ${res.businessName}! Puedes bloquear tu pantalla.",
                                            Toast.LENGTH_LONG
                                        ).show()
                                    } else {
                                        Toast.makeText(context, res.errorMessage, Toast.LENGTH_LONG).show()
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00897B))
                        ) {
                            Text(
                                if (speakerLoading) "Conectando..." else "Conectar Parlante de Caja",
                                color = Color.White,
                                fontWeight = FontWeight.Bold
                            )
                        }

                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedButton(
                                onClick = {
                                    SensorKeepAliveService.testSpeakerVoice(context)
                                },
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("▶ Probar Voz S/ 35.50", fontSize = 12.sp)
                            }

                            if (savedSpeakerToken.isNotBlank()) {
                                OutlinedButton(
                                    onClick = {
                                        preferencesManager.clearSpeakerSession()
                                        Toast.makeText(context, "Parlante desconectado", Toast.LENGTH_SHORT).show()
                                    },
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Text("Cerrar Sesión", fontSize = 12.sp, color = Color(0xFFC62828))
                                }
                            }
                        }
                    }
                }
            } else {
                // =============================================================
                // PESTAÑA 1: MODO SENSOR RECEPTOR (CELULAR CON YAPE / PLIN / BBVA)
                // =============================================================
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = if (isPermissionGranted) Color(0xFFE8F5E9) else Color(0xFFFFEBEE)
                    )
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = if (isPermissionGranted) "1. LECTOR DE NOTIFICACIONES ACTIVO" else "1. ACTIVAR PERMISO DE NOTIFICACIONES",
                            fontWeight = FontWeight.Bold,
                            color = if (isPermissionGranted) Color(0xFF2E7D32) else Color(0xFFC62828),
                            fontSize = 14.sp
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = if (isPermissionGranted)
                                if (isServiceConnected) "🟢 Escuchando apps oficiales (Yape, Plin, BBVA) con filtro antifraude."
                                else "🟡 Permiso otorgado. Toca 'Re-activar' si no detecta."
                            else
                                "Otorga permiso en el celular donde están instalados Yape / Plin / BBVA.",
                            fontSize = 12.sp,
                            color = Color.DarkGray
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Button(
                                onClick = {
                                    rebindService()
                                    openSettings()
                                    scope.launch {
                                        delay(1000)
                                        isPermissionGranted = checkPermission()
                                        rebindService()
                                    }
                                },
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF740099))
                            ) {
                                Text(if (isPermissionGranted) "Re-activar" else "Activar Lector", color = Color.White, fontSize = 12.sp)
                            }

                            OutlinedButton(
                                onClick = { openAppDetails() },
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Ajustes App", fontSize = 12.sp)
                            }
                        }
                    }
                }

                // Vinculación Rápida por Código de 6 Dígitos
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFF3E5F5))
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Text(
                            text = if (savedApiKey.isNotBlank())
                                "✅ CELULAR VINCULADO ${if (savedBusinessName.isNotBlank()) "A: $savedBusinessName" else ""}"
                            else
                                "⚡ VINCULAR RÁPIDO CON CÓDIGO DE 6 DÍGITOS",
                            fontWeight = FontWeight.ExtraBold,
                            color = Color(0xFF4A148C),
                            fontSize = 14.sp
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "En tu Panel Web abre 'Mi Negocio', genera tu código numérico de 6 dígitos e ingrésalo aquí:",
                            fontSize = 12.sp,
                            color = Color.DarkGray
                        )
                        Spacer(modifier = Modifier.height(8.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedTextField(
                                value = pairingCodeInput,
                                onValueChange = { raw ->
                                    pairingCodeInput = raw.filter { it.isDigit() }.take(6)
                                },
                                label = { Text("Código 6 dígitos") },
                                placeholder = { Text("Ej: 482915") },
                                modifier = Modifier.weight(1f),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                singleLine = true
                            )

                            Button(
                                enabled = pairingCodeInput.length == 6 && !pairingLoading,
                                onClick = {
                                    scope.launch {
                                        pairingLoading = true
                                        val result = repository.redeemPairingCode(urlInput, pairingCodeInput)
                                        pairingLoading = false
                                        if (result.success) {
                                            pairingCodeInput = ""
                                            SensorKeepAliveService.start(context)
                                            repository.sendHeartbeat()
                                            Toast.makeText(
                                                context,
                                                "¡Vinculado a ${result.businessName}!",
                                                Toast.LENGTH_LONG
                                            ).show()
                                        } else {
                                            Toast.makeText(context, result.errorMessage, Toast.LENGTH_LONG).show()
                                        }
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00897B))
                            ) {
                                Text(if (pairingLoading) "..." else "Vincular", color = Color.White)
                            }
                        }

                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedButton(
                                enabled = savedApiKey.isNotBlank(),
                                onClick = {
                                    scope.launch {
                                        DiagnosticLogger.log("🧪 Enviando pago de prueba firmado...")
                                        repository.saveAndUploadPayment(
                                            remitente = "PRUEBA SENSOR V2",
                                            monto = 1.00,
                                            timestamp = System.currentTimeMillis(),
                                            codigoSeguridad = "777",
                                            banco = "YAPE",
                                            packageName = "com.bcp.innovacxion.yapeapp"
                                        )
                                        repository.sendHeartbeat()
                                        Toast.makeText(context, "Pago de prueba S/ 1.00 enviado", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            ) {
                                Text("Probar Envío S/ 1.00", fontSize = 12.sp)
                            }

                            TextButton(onClick = { showAdvancedManual = !showAdvancedManual }) {
                                Text(
                                    if (showAdvancedManual) "Ocultar modo manual" else "Configuración manual",
                                    fontSize = 12.sp,
                                    color = Color(0xFF740099)
                                )
                            }
                        }

                        if (showAdvancedManual) {
                            Spacer(modifier = Modifier.height(6.dp))
                            OutlinedTextField(
                                value = urlInput,
                                onValueChange = { urlInput = it },
                                label = { Text("URL del Servidor SaaS") },
                                placeholder = { Text("https://yape-orcin.vercel.app") },
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                                singleLine = true
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            OutlinedTextField(
                                value = apiKeyInput,
                                onValueChange = { apiKeyInput = it },
                                label = { Text("API Key Manual") },
                                placeholder = { Text("yp_live_...") },
                                modifier = Modifier.fillMaxWidth(),
                                visualTransformation = PasswordVisualTransformation(),
                                singleLine = true
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Button(
                                onClick = {
                                    scope.launch {
                                        preferencesManager.saveSettings(urlInput, apiKeyInput)
                                        SensorKeepAliveService.start(context)
                                        repository.sendHeartbeat()
                                        Toast.makeText(context, "Configuración manual guardada", Toast.LENGTH_SHORT).show()
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF740099))
                            ) {
                                Text("Guardar Manualmente", color = Color.White)
                            }
                        }
                    }
                }
            }

            // Consola de Diagnóstico en Vivo
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
                            text = "📋 REGISTRO EN VIVO",
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
                            .height(150.dp)
                            .background(Color(0xFF121212), RoundedCornerShape(4.dp))
                            .padding(8.dp)
                    ) {
                        if (liveLogs.isEmpty()) {
                            Text(
                                text = if (activeMode == PreferencesManager.MODE_SPEAKER)
                                    "Modo Parlante listo.\nEsperando pagos entrantes para anunciarlos en voz alta..."
                                else
                                    "Modo Sensor listo.\nEsperando notificaciones oficiales de Yape, Plin o BBVA...",
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
                                        color = if (logLine.contains("ERROR") || logLine.contains("❌") || logLine.contains("🛡️")) Color(0xFFFF8A80)
                                                else if (logLine.contains("ÉXITO") || logLine.contains("✅") || logLine.contains("🚀") || logLine.contains("🔊")) Color(0xFFB9F6CA)
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
