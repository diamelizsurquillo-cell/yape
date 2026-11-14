const { execFile } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const readline = require('readline');

const DEFAULT_BACKEND_URL = process.env.YAPE_BACKEND_URL || 'https://yape-orcin.vercel.app';
const SCRIPTS_DIR = path.join(__dirname);
const CONFIG_PATH = path.join(SCRIPTS_DIR, 'config-cliente.json');
const SAFE_PS1_PATH = path.join(SCRIPTS_DIR, 'alerta-segura.ps1');

const announcedPaymentIds = new Set();

function sanitizePlainText(val, maxLen = 80) {
  return String(val || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function fetchJson(targetUrl, apiKey) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      return reject(err);
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      parsed,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-API-Key': apiKey
        },
        timeout: 8000
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(raw || '{}');
            resolve({ status: res.statusCode, data: json });
          } catch {
            reject(new Error(`Respuesta inválida del servidor (${res.statusCode})`));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Tiempo de espera agotado'));
    });
    req.on('error', reject);
    req.end();
  });
}

// SEC-04: Sin concatenación de código PowerShell. Datos pasados exclusivamente por variables de entorno (env).
function showNativeWindowsAlert(payment) {
  const numericAmount = Number(payment.monto || 0);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return;

  const monto = numericAmount.toFixed(2);
  const remitente = sanitizePlainText(payment.remitente || 'Cliente', 80);
  const codigo = sanitizePlainText(payment.codigo_seguridad || '-', 20);
  const bancoUpper = sanitizePlainText(payment.banco || 'YAPE', 12).toUpperCase();
  const canal = bancoUpper === 'BBVA' ? 'BBVA' : bancoUpper === 'PLIN' ? 'PLIN' : 'YAPE';

  const soles = Math.floor(numericAmount);
  const centimos = Math.round((numericAmount - soles) * 100);
  let vozTexto = `${canal}! `;
  if (soles === 1 && centimos === 0) vozTexto += '1 sol';
  else if (soles > 0 && centimos === 0) vozTexto += `${soles} soles`;
  else if (soles === 0 && centimos > 0) vozTexto += `${centimos} centimos`;
  else vozTexto += `${soles} soles con ${centimos} centimos`;

  console.log(`[NUEVO PAGO ${canal}] S/ ${monto} de ${remitente} (Cód: ${codigo})`);

  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SAFE_PS1_PATH],
    {
      env: {
        ...process.env,
        YAPE_CANAL: canal,
        YAPE_MONTO: monto,
        YAPE_CLIENTE: remitente,
        YAPE_CODIGO: codigo,
        YAPE_VOZ: vozTexto
      },
      windowsHide: true
    },
    (err) => {
      if (err) console.error('Error al mostrar alerta nativa:', err.message);
    }
  );
}

async function resolveTenantConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (saved && saved.api_key && saved.backend_url) {
        return saved;
      }
    } catch {
      // Reconfigurar si el archivo está corrupto
    }
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  console.log('====================================================');
  console.log('   CONFIGURACION SEGURA - RECEPTOR WINDOWS SAAS');
  console.log('====================================================');
  const urlAnswer = (await ask(`URL del servidor [${DEFAULT_BACKEND_URL}]: `)).trim();
  const backendUrl = (urlAnswer || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
  const apiKeyInput = (await ask('Ingresa la API Key exclusiva de tu negocio (ej. yp_live_...): ')).trim();
  rl.close();

  if (!apiKeyInput) {
    console.error('ERROR: Debes ingresar la API Key de tu negocio para conectar de forma segura.');
    process.exit(1);
  }

  const testUrl = `${backendUrl}/api/pagos?modo=desktop_poll&since=${Math.floor(Date.now() / 1000)}`;
  const { status, data } = await fetchJson(testUrl, apiKeyInput);

  if (status !== 200) {
    console.error('ERROR DE AUTENTICACION:', data.error || `Código HTTP ${status}`);
    process.exit(1);
  }

  const cfg = {
    backend_url: backendUrl,
    api_key: apiKeyInput,
    nombre_comercial: data.negocio || 'Mi Negocio'
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

async function startDesktopMonitor() {
  try {
    const cfg = await resolveTenantConfig();
    let lastCheckEpoch = Math.floor(Date.now() / 1000);
    let isFirstSync = true;

    console.log('====================================================');
    console.log(`   RECEPTOR DE ESCRITORIO: ${cfg.nombre_comercial}`);
    console.log(`   SERVIDOR: ${cfg.backend_url}`);
    console.log('====================================================');
    console.log('Sincronización cifrada activa. Esperando pagos de Yape / Plin / BBVA...');
    console.log('(Puedes minimizar esta ventana)');

    const pollPayments = async () => {
      try {
        const pollUrl = `${cfg.backend_url}/api/pagos?modo=desktop_poll&since=${lastCheckEpoch - 15}`;
        const { status, data } = await fetchJson(pollUrl, cfg.api_key);

        if (status === 401 || status === 403) {
          console.error(`[ALERTA] Acceso denegado o suscripción vencida: ${data.error || status}`);
          return;
        }
        if (status !== 200 || !Array.isArray(data.pagos)) return;

        for (const p of data.pagos) {
          if (!announcedPaymentIds.has(p.id)) {
            announcedPaymentIds.add(p.id);
            if (!isFirstSync) {
              showNativeWindowsAlert(p);
            }
          }
          if (p.timestamp && p.timestamp > lastCheckEpoch) {
            lastCheckEpoch = p.timestamp;
          }
        }

        // Mantener memoria acotada
        if (announcedPaymentIds.size > 500) {
          const firstKey = announcedPaymentIds.values().next().value;
          announcedPaymentIds.delete(firstKey);
        }

        isFirstSync = false;
      } catch (err) {
        console.warn('[Reintentando conexión...]', err.message);
      }
    };

    await pollPayments();
    setInterval(pollPayments, 3000);
  } catch (err) {
    console.error('Error fatal al iniciar monitor:', err.message);
    process.exit(1);
  }
}

startDesktopMonitor();
