import crypto from 'crypto';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

export function getJwtSecret() {
  return process.env.JWT_SECRET || 'super_secreto_token_yape_987';
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

// Firma un JWT estándar HS256 (100% compatible con jsonwebtoken) sin dependencias externas
export function signJwt(payload, expiresInSeconds = 86400 * 7) {
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

  if (signatureB64 !== expectedSig) return null;

  try {
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

export function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key, Authorization'
  );
}

export function getSupabaseClient() {
  let supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  if (supabaseUrl && !supabaseUrl.startsWith('http://') && !supabaseUrl.startsWith('https://')) {
    supabaseUrl = `https://${supabaseUrl}`;
  }
  supabaseUrl = supabaseUrl.replace(/\/+$/, '');

  const supabaseKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  if (!supabaseUrl || !supabaseKey) {
    return { supabase: null, hasUrl: Boolean(supabaseUrl), hasKey: Boolean(supabaseKey) };
  }

  return {
    supabase: createClient(supabaseUrl, supabaseKey, {
      realtime: { transport: WebSocket }
    }),
    hasUrl: true,
    hasKey: true
  };
}

export function generateTenantApiKey() {
  return `yp_live_${crypto.randomBytes(12).toString('hex')}`;
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
