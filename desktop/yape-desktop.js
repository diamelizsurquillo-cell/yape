const { createClient } = require('@supabase/supabase-js');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const WebSocket = require('ws');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qgrqscheychrltkecfdx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_cAk7d4d4lzyVCViMZZnOoA_oJCEbpo4';
const SCRIPTS_DIR = path.join(__dirname);
const CONFIG_PATH = path.join(SCRIPTS_DIR, 'config-cliente.json');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { transport: WebSocket }
});

function showNativeWindowsAlert(payment) {
  const monto = Number(payment.monto || 0).toFixed(2);
  const remitente = (payment.remitente || 'Cliente').replace(/['"`$]/g, '');
  const codigo = (payment.codigo_seguridad || '').replace(/['"`$]/g, '');
  const bancoUpper = (payment.banco || 'YAPE').toUpperCase();
  const canal = bancoUpper === 'BBVA' ? 'BBVA' : bancoUpper === 'PLIN' ? 'PLIN' : 'YAPE';

  const soles = Math.floor(payment.monto || 0);
  const centimos = Math.round(((payment.monto || 0) - soles) * 100);
  let vozTexto = `${canal}! `;
  if (soles === 1 && centimos === 0) vozTexto += '1 sol';
  else if (soles > 0 && centimos === 0) vozTexto += `${soles} soles`;
  else if (soles === 0 && centimos > 0) vozTexto += `${centimos} centimos`;
  else vozTexto += `${soles} soles con ${centimos} centimos`;

  console.log(`[NUEVO PAGO ${canal}] S/ ${monto} de ${remitente}`);

  const scriptContent = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Speech

[System.Media.SystemSounds]::Asterisk.Play()
Start-Sleep -Milliseconds 400

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 1
$synth.Volume = 100
$synth.SpeakAsync('${vozTexto}')

[System.Windows.Forms.MessageBox]::Show(
    "Canal: ${canal}\`nMonto: S/ ${monto}\`nCliente: ${remitente}\`nCodigo: ${codigo}",
    "${canal} RECIBIDO!",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1,
    [System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly
)
`;

  const scriptPath = path.join(SCRIPTS_DIR, 'alerta-temp.ps1');
  fs.writeFileSync(scriptPath, scriptContent, 'utf8');

  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], (err) => {
    if (err) console.log('Error al mostrar alerta:', err.message);
  });
}

async function resolveTenantConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {}
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  console.log('====================================================');
  console.log('   CONFIGURACION INICIAL - RECEPTOR WINDOWS SAAS');
  console.log('====================================================');
  const apiKeyInput = (await ask('Ingresa la API Key de tu negocio (o presiona ENTER para modo general): ')).trim();
  rl.close();

  if (!apiKeyInput) {
    const cfg = { mode: 'ALL', negocio_id: null, nombre_comercial: 'Modo General' };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    return cfg;
  }

  const { data: neg } = await supabase
    .from('negocios')
    .select('id, nombre_comercial, estado, fecha_vencimiento')
    .eq('api_key', apiKeyInput)
    .maybeSingle();

  if (!neg) {
    console.error('ERROR: API Key no encontrada en la base de datos.');
    process.exit(1);
  }

  const cfg = {
    mode: 'TENANT',
    api_key: apiKeyInput,
    negocio_id: neg.id,
    nombre_comercial: neg.nombre_comercial
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

async function startDesktopMonitor() {
  const cfg = await resolveTenantConfig();

  console.log('====================================================');
  console.log(`   RECEPTOR DE ESCRITORIO: ${cfg.nombre_comercial}`);
  console.log('====================================================');
  console.log('Conectando en tiempo real...');

  const filterConfig = { event: 'INSERT', schema: 'public', table: 'pagos' };
  if (cfg.negocio_id) {
    filterConfig.filter = `negocio_id=eq.${cfg.negocio_id}`;
  }

  supabase
    .channel(`desktop-pagos-${cfg.negocio_id || 'all'}`)
    .on('postgres_changes', filterConfig, (payload) => {
      if (cfg.negocio_id && payload.new.negocio_id !== cfg.negocio_id) return;
      showNativeWindowsAlert(payload.new);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Conectado OK. Esperando pagos de Yape / Plin / BBVA...');
        console.log('(Puedes minimizar esta ventana)');
      }
    });

  setInterval(() => {}, 1000 * 60 * 60);
}

startDesktopMonitor();
