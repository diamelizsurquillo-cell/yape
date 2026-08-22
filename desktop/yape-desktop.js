const { createClient } = require('@supabase/supabase-js');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const SUPABASE_URL = 'https://qgrqscheychrltkecfdx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_cAk7d4d4lzyVCViMZZnOoA_oJCEbpo4';
const SCRIPTS_DIR = path.join(__dirname);

console.log('====================================================');
console.log('   YAPE MONITOR - RECEPTOR DE ESCRITORIO WINDOWS');
console.log('====================================================');
console.log('Conectando con Supabase en tiempo real...');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { transport: WebSocket }
});

function showNativeWindowsAlert(payment) {
  const monto = Number(payment.monto || 0).toFixed(2);
  const remitente = (payment.remitente || 'Cliente').replace(/['"]/g, '');
  const codigo = payment.codigo_seguridad || '';
  const isBbva = (payment.banco || '').toUpperCase() === 'BBVA';
  const canal = isBbva ? 'BBVA' : 'YAPE';

  // Texto para voz
  const soles = Math.floor(payment.monto || 0);
  const centimos = Math.round(((payment.monto || 0) - soles) * 100);
  let vozTexto = isBbva ? 'BBVA! ' : 'Yape! ';
  if (soles === 1 && centimos === 0) vozTexto += '1 sol';
  else if (soles > 0 && centimos === 0) vozTexto += soles + ' soles';
  else if (soles === 0 && centimos > 0) vozTexto += centimos + ' centimos';
  else vozTexto += soles + ' soles con ' + centimos + ' centimos';

  console.log(`[NUEVO PAGO ${canal}] S/ ${monto} de ${remitente}`);

  // Crear script temporal .ps1 con los datos del pago
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

// Suscribirse a los pagos en tiempo real con Supabase
const channel = supabase
  .channel('desktop-pagos')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'pagos' },
    (payload) => {
      showNativeWindowsAlert(payload.new);
    }
  )
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log('');
      console.log('Conectado a Supabase OK');
      console.log('ESPERANDO YAPES...');
      console.log('');
      console.log('Cuando llegue un Yape:');
      console.log('  - Sonara la campana de Windows');
      console.log('  - Hablara por el parlante el monto');
      console.log('  - Saltara ventana de Windows con el detalle');
      console.log('');
      console.log('(Puedes minimizar esta ventana)');
    }
  });

// Mantener proceso vivo
setInterval(() => {}, 1000 * 60 * 60);
