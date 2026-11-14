import crypto from 'crypto';
import net from 'net';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

// Rate limiter en memoria por instancia Serverless / Node
const rateLimitBuckets = new Map();

const LEGACY_FALLBACK_JWT_SECRETS = [
  'super_secreto_token_yape_987_local_fallback',
  'super_secreto_token_yape_987'
];

export function getJwtSecret() {
  const envSecret = (process.env.JWT_SECRET || '').trim();
  if (envSecret.length >= 16) return envSecret;
  // Si existe SUPABASE_SERVICE_ROLE_KEY en producción y no definieron JWT_SECRET aún, derivar secreto único fuerte
  const srk = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
  if (srk.length >= 20) {
    return crypto.createHash('sha256').update(`yape-jwt-derived:${srk}`).digest('hex');
  }
  return envSecret || LEGACY_FALLBACK_JWT_SECRETS[0];
}

function deriveAesKeyFromSecret(secretStr) {
  return crypto.scryptSync(secretStr, 'yape-saas-pwd-salt-v1', 32);
}

// Cifrado autenticado AES-256-GCM para no guardar contraseñas en texto plano en la BD
export function encryptSecret(plainText) {
  const text = String(plainText || '');
  if (!text || text.startsWith('enc:v1:')) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveAesKeyFromSecret(getJwtSecret()), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(storedValue) {
  const val = String(storedValue || '');
  if (!val.startsWith('enc:v1:')) return val; // Retrocompatible con registros previos
  const parts = val.split(':');
  if (parts.length !== 5) return '';
  const iv = Buffer.from(parts[2], 'hex');
  const authTag = Buffer.from(parts[3], 'hex');
  const encrypted = Buffer.from(parts[4], 'hex');

  const candidateSecrets = [getJwtSecret(), ...LEGACY_FALLBACK_JWT_SECRETS];
  for (const sec of candidateSecrets) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', deriveAesKeyFromSecret(sec), iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      // Intentar con llave previa si hubo rotación de JWT_SECRET
    }
  }
  return '';
}

export function getSecurityPosture() {
  const usingServiceRole = Boolean(
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim()
  );
  const hasCustomJwtSecret =
    (process.env.JWT_SECRET || '').trim().length >= 16 || usingServiceRole;
  const hasCustomAdminPass = Boolean(
    process.env.DASHBOARD_PASSWORD && process.env.DASHBOARD_PASSWORD !== 'yape1234'
  );
  return {
    usingServiceRole,
    hasCustomJwtSecret,
    hasCustomAdminPass
  };
}

export function safeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) {
    // Ejecutar comparación dummy del mismo tamaño para mantener tiempo constante
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyPasswordTimingSafe(storedValue, candidatePlain) {
  const realPlain = decryptSecret(storedValue);
  if (!realPlain) return false;
  return safeEqualStrings(realPlain, String(candidatePlain || ''));
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

// Firma JWT estándar HS256
export function signJwt(payload, expiresInSeconds = 86400 * 3) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(fullPayload))}`;
  const signature = crypto
    .createHmac('sha256', getJwtSecret())
    .update(unsigned)
    .digest();
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

export function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  const unsigned = `${headerB64}.${payloadB64}`;
  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', getJwtSecret()).update(unsigned).digest()
  );

  if (!safeEqualStrings(signatureB64, expectedSig)) return null;

  try {
    const header = JSON.parse(base64UrlDecode(headerB64));
    if (header.alg !== 'HS256') return null;
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function extractAuthUser(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return verifyJwt(token);
}

// Cabeceras HTTP de Seguridad + CORS controlado
export function setCorsHeaders(res, req) {
  const origin = req?.headers?.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-Requested-With, Accept, Content-Type, X-API-Key, Authorization, X-Signature-256, X-Request-Timestamp'
  );
  res.setHeader('Access-Control-Expose-Headers', 'X-Sensor-Status');
  // Hardening HTTP Security Headers (OWASP)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

export function getClientIp(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req?.socket?.remoteAddress || 'unknown';
}

export function checkRateLimit(bucketKey, maxRequests = 10, windowMs = 60_000) {
  const now = Date.now();
  // Limpieza periódica de memoria
  if (rateLimitBuckets.size > 2000) {
    for (const [k, v] of rateLimitBuckets.entries()) {
      if (now > v.resetAt) rateLimitBuckets.delete(k);
    }
  }

  const entry = rateLimitBuckets.get(bucketKey);
  if (!entry || now > entry.resetAt) {
    rateLimitBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  entry.count += 1;
  if (entry.count > maxRequests) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}

// Protección Anti-SSRF estricta para Webhooks configurados por clientes
function isPrivateOrReservedIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true; // Cloud metadata IP!
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    if (norm === '::1' || norm === '::' || norm.startsWith('fc') || norm.startsWith('fd') || norm.startsWith('fe80')) {
      return true;
    }
    return false;
  }
  return false;
}

export function validateSafeWebhookUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { valid: true, url: '' };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'URL de Webhook inválida' };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'Por seguridad, el Webhook debe usar obligatoriamente protocolo seguro https://'
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    isPrivateOrReservedIp(host)
  ) {
    return {
      valid: false,
      error: 'URL de Webhook rechazada por política de seguridad (hosts internos o privados no permitidos).'
    };
  }

  return { valid: true, url: parsed.toString() };
}

export function getSupabaseClient() {
  let supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  if (supabaseUrl && !supabaseUrl.startsWith('http://') && !supabaseUrl.startsWith('https://')) {
    supabaseUrl = `https://${supabaseUrl}`;
  }
  supabaseUrl = supabaseUrl.replace(/\/+$/, '');

  const serviceRoleKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ''
  ).trim();

  const fallbackAnonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  const supabaseKey = serviceRoleKey || fallbackAnonKey;

  if (!supabaseUrl || !supabaseKey) {
    return {
      supabase: null,
      hasUrl: Boolean(supabaseUrl),
      hasKey: Boolean(supabaseKey),
      usingServiceRole: false
    };
  }

  return {
    supabase: createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: WebSocket }
    }),
    hasUrl: true,
    hasKey: true,
    usingServiceRole: Boolean(serviceRoleKey)
  };
}

export function generateTenantApiKey() {
  return `yp_live_${crypto.randomBytes(16).toString('hex')}`;
}

// Secreto HMAC exclusivo por cliente derivado criptográficamente (Sensor v2.0)
export function deriveTenantHmacSecret(apiKey) {
  return crypto
    .createHmac('sha256', getJwtSecret())
    .update(`yape-sensor-hmac-v2:${String(apiKey || '')}`)
    .digest('hex');
}

export function computeHmacSha256Hex(secretHexOrStr, canonicalMessage) {
  return crypto
    .createHmac('sha256', String(secretHexOrStr || ''))
    .update(String(canonicalMessage || ''), 'utf8')
    .digest('hex');
}

export function verifySensorHmac({ apiKey, reqTimestamp, canonicalMessage, signatureHex }) {
  const sig = String(signatureHex || '').trim().toLowerCase();
  if (!sig) return { verified: false, provided: false };

  const tsNum = parseInt(String(reqTimestamp || '0'), 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > 300) {
    return {
      verified: false,
      provided: true,
      error: 'Firma del sensor expirada (desfase de reloj mayor a 5 minutos).'
    };
  }

  const secret = deriveTenantHmacSecret(apiKey);
  const expected = computeHmacSha256Hex(secret, canonicalMessage);
  if (!safeEqualStrings(sig, expected)) {
    return {
      verified: false,
      provided: true,
      error: 'Firma criptográfica HMAC-SHA256 inválida.'
    };
  }

  return { verified: true, provided: true };
}

// Lectura/escritura resiliente de telemetría y código de 6 dígitos (soporta esquema con o sin migración v2)
export function extractSensorMeta(negocio) {
  if (!negocio) {
    return {
      pairing_code: null,
      pairing_expires_at: null,
      sensor_last_seen: null,
      sensor_battery: null,
      sensor_device_name: '',
      online: false,
      seconds_ago: null
    };
  }

  let fallback = {};
  const rawTg = String(negocio.telegram_chat_id || '');
  if (rawTg.startsWith('{') && rawTg.endsWith('}')) {
    try {
      fallback = JSON.parse(rawTg);
    } catch {
      fallback = {};
    }
  }

  const pairing_code = negocio.pairing_code ?? fallback.pair ?? null;
  const pairing_expires_at = negocio.pairing_expires_at ?? fallback.exp ?? null;
  const sensor_last_seen = negocio.sensor_last_seen ?? fallback.seen ?? null;
  const rawBat = negocio.sensor_battery ?? fallback.bat ?? null;
  const sensor_battery =
    rawBat !== null && rawBat !== undefined && Number.isFinite(Number(rawBat))
      ? Math.max(0, Math.min(100, Math.round(Number(rawBat))))
      : null;
  const sensor_device_name = negocio.sensor_device_name || fallback.dev || '';

  let online = false;
  let seconds_ago = null;
  if (sensor_last_seen) {
    const seenMs = new Date(sensor_last_seen).getTime();
    if (!isNaN(seenMs)) {
      seconds_ago = Math.max(0, Math.floor((Date.now() - seenMs) / 1000));
      online = seconds_ago <= 180; // En línea si reportó en los últimos 3 minutos
    }
  }

  return {
    pairing_code,
    pairing_expires_at,
    sensor_last_seen,
    sensor_battery,
    sensor_device_name,
    online,
    seconds_ago
  };
}

export async function updateSensorMetaInSupabase(supabase, negocio, patch) {
  const current = extractSensorMeta(negocio);
  const merged = {
    pairing_code: patch.pairing_code !== undefined ? patch.pairing_code : current.pairing_code,
    pairing_expires_at:
      patch.pairing_expires_at !== undefined ? patch.pairing_expires_at : current.pairing_expires_at,
    sensor_last_seen:
      patch.sensor_last_seen !== undefined ? patch.sensor_last_seen : current.sensor_last_seen,
    sensor_battery:
      patch.sensor_battery !== undefined ? patch.sensor_battery : current.sensor_battery,
    sensor_device_name:
      patch.sensor_device_name !== undefined ? patch.sensor_device_name : current.sensor_device_name
  };

  // Intentar primero en columnas nativas v2
  const { error } = await supabase
    .from('negocios')
    .update(merged)
    .eq('id', negocio.id);

  if (!error) return { ok: true };

  // Fallback automático en telegram_chat_id si el usuario aún no corrió supabase_device_pairing_migration.sql
  const compactFallback = JSON.stringify({
    pair: merged.pairing_code,
    exp: merged.pairing_expires_at,
    seen: merged.sensor_last_seen,
    bat: merged.sensor_battery,
    dev: merged.sensor_device_name
  });

  const retry = await supabase
    .from('negocios')
    .update({ telegram_chat_id: compactFallback })
    .eq('id', negocio.id);

  return { ok: !retry.error, error: retry.error };
}

export function sanitizeText(str, maxLength = 100) {
  return String(str || '')
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function checkBusinessSubscription(negocio) {
  if (!negocio) return { valid: false, reason: 'Negocio no encontrado' };
  if ((negocio.estado || 'ACTIVO').toUpperCase() !== 'ACTIVO') {
    return {
      valid: false,
      reason: 'Tu cuenta se encuentra suspendida. Contacta a soporte para reactivar tu servicio.'
    };
  }
  if (negocio.fecha_vencimiento) {
    const exp = new Date(negocio.fecha_vencimiento);
    if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
      return {
        valid: false,
        reason: 'Tu suscripción ha vencido. Por favor renueva tu plan para continuar recibiendo y validando pagos.'
      };
    }
  }
  return { valid: true };
}
