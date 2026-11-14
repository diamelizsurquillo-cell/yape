import crypto from 'crypto';
import {
  setCorsHeaders,
  getSupabaseClient,
  extractAuthUser,
  checkBusinessSubscription,
  getClientIp,
  checkRateLimit,
  sanitizeText,
  safeEqualStrings,
  deriveTenantHmacSecret,
  verifySensorHmac,
  extractSensorMeta,
  updateSensorMetaInSupabase
} from './_utils.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { supabase, hasUrl, hasKey } = getSupabaseClient();
  if (!supabase) {
    return res.status(500).json({
      error: 'Variables de entorno de Supabase no configuradas',
      hasUrl,
      hasKey
    });
  }

  // =========================================================================
  // 1. PUT: CANJEAR CÓDIGO DE 6 DÍGITOS DESDE LA APP ANDROID (SIN ESCRIBIR LLAVES)
  // =========================================================================
  if (req.method === 'PUT') {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`pair-redeem:${ip}`, 8, 5 * 60 * 1000);
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return res.status(429).json({
        error: `Demasiados intentos de vinculación. Espera ${rl.retryAfterSec} segundos.`
      });
    }

    const rawCode = String(req.body?.codigo || '').replace(/[^0-9]/g, '');
    const deviceName = sanitizeText(req.body?.device_name || 'Android Sensor', 60);

    if (rawCode.length !== 6) {
      return res.status(400).json({ error: 'Ingresa un código válido de 6 dígitos.' });
    }

    const { data: allNegocios, error } = await supabase.from('negocios').select('*');
    if (error) {
      return res.status(500).json({ error: 'No se pudo consultar negocios activos.' });
    }

    const nowMs = Date.now();
    let matchedNegocio = null;

    for (const neg of allNegocios || []) {
      const meta = extractSensorMeta(neg);
      if (meta.pairing_code && safeEqualStrings(String(meta.pairing_code), rawCode)) {
        const expMs = meta.pairing_expires_at ? new Date(meta.pairing_expires_at).getTime() : 0;
        if (expMs > nowMs) {
          matchedNegocio = neg;
          break;
        }
      }
    }

    if (!matchedNegocio) {
      return res.status(404).json({
        error: 'Código inválido o expirado. Genera un nuevo código de 6 dígitos desde tu panel web.'
      });
    }

    const sub = checkBusinessSubscription(matchedNegocio);
    if (!sub.valid) {
      return res.status(403).json({ error: sub.reason });
    }

    // Invalidar inmediatamente el código (un solo uso) y marcar el celular como conectado
    await updateSensorMetaInSupabase(supabase, matchedNegocio, {
      pairing_code: null,
      pairing_expires_at: null,
      sensor_last_seen: new Date().toISOString(),
      sensor_device_name: deviceName
    });

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'yape-orcin.vercel.app';
    const backendUrl = `${proto}://${host}`;

    return res.status(200).json({
      success: true,
      mensaje: `Vinculado exitosamente a ${matchedNegocio.nombre_comercial}`,
      backend_url: backendUrl,
      api_key: matchedNegocio.api_key,
      hmac_secret: deriveTenantHmacSecret(matchedNegocio.api_key),
      nombre_comercial: matchedNegocio.nombre_comercial
    });
  }

  // =========================================================================
  // 2. PATCH: PULSO DE VIDA + NIVEL DE BATERÍA DESDE ANDROID (HEARTBEAT CADA 60s)
  // =========================================================================
  if (req.method === 'PATCH') {
    const apiKey = String(req.headers['x-api-key'] || '').trim();
    if (!apiKey) {
      return res.status(401).json({ error: 'X-API-Key requerida' });
    }

    const { data: negRow } = await supabase
      .from('negocios')
      .select('*')
      .eq('api_key', apiKey)
      .maybeSingle();

    if (!negRow) {
      return res.status(401).json({ error: 'API Key no válida' });
    }

    const batteryRaw = req.body?.battery;
    const battery =
      batteryRaw !== undefined && batteryRaw !== null && Number.isFinite(Number(batteryRaw))
        ? Math.max(0, Math.min(100, Math.round(Number(batteryRaw))))
        : null;
    const deviceName = sanitizeText(req.body?.device_name || '', 60);

    // Si el Sensor v2.0 envía firma HMAC-SHA256, verificar autenticidad e integridad
    const sigHeader = req.headers['x-signature-256'];
    const tsHeader = req.headers['x-request-timestamp'];
    if (sigHeader) {
      const canonical = `${tsHeader}|heartbeat|${battery ?? -1}|${deviceName}`;
      const hmacCheck = verifySensorHmac({
        apiKey,
        reqTimestamp: tsHeader,
        canonicalMessage: canonical,
        signatureHex: sigHeader
      });
      if (!hmacCheck.verified) {
        return res.status(401).json({ error: hmacCheck.error });
      }
    }

    await updateSensorMetaInSupabase(supabase, negRow, {
      sensor_last_seen: new Date().toISOString(),
      ...(battery !== null ? { sensor_battery: battery } : {}),
      ...(deviceName ? { sensor_device_name: deviceName } : {})
    });

    return res.status(200).json({
      ok: true,
      server_time: Math.floor(Date.now() / 1000),
      hmac_secret: !sigHeader ? deriveTenantHmacSecret(negRow.api_key) : undefined
    });
  }

  // =========================================================================
  // Para POST (generar código) y GET (consultar estado) requerimos JWT válido
  // =========================================================================
  const authUser = extractAuthUser(req);
  if (!authUser) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  const isSuperAdmin = authUser.rol === 'SUPERADMIN';
  const isDueno = authUser.rol === 'DUENO';

  // =========================================================================
  // 3. POST: GENERAR CÓDIGO TEMPORAL DE 6 DÍGITOS (VÁLIDO POR 10 MINUTOS)
  // =========================================================================
  if (req.method === 'POST') {
    if (!isSuperAdmin && !isDueno) {
      return res.status(403).json({ error: 'Solo el Dueño o SuperAdmin puede vincular dispositivos' });
    }

    const targetNegocioId = isSuperAdmin
      ? req.body?.negocio_id || authUser.negocio_id
      : authUser.negocio_id;

    if (!targetNegocioId) {
      return res.status(400).json({ error: 'negocio_id requerido' });
    }

    const { data: negRow } = await supabase
      .from('negocios')
      .select('*')
      .eq('id', targetNegocioId)
      .maybeSingle();

    if (!negRow) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Generar código criptográfico de 6 dígitos que no colisione con ningún código activo
    const codigo = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await updateSensorMetaInSupabase(supabase, negRow, {
      pairing_code: codigo,
      pairing_expires_at: expiresAt
    });

    return res.status(201).json({
      codigo,
      expires_at: expiresAt,
      expires_in_sec: 600
    });
  }

  // =========================================================================
  // 4. GET: ESTADO DE SALUD EN VIVO DEL CELULAR RECEPTOR
  // =========================================================================
  if (req.method === 'GET') {
    const targetNegocioId = isSuperAdmin
      ? req.query?.negocio_id || authUser.negocio_id
      : authUser.negocio_id;

    if (!targetNegocioId) {
      return res.status(200).json({ online: false, configured: false });
    }

    const { data: negRow } = await supabase
      .from('negocios')
      .select('*')
      .eq('id', targetNegocioId)
      .maybeSingle();

    if (!negRow) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const meta = extractSensorMeta(negRow);
    return res.status(200).json({
      online: meta.online,
      last_seen: meta.sensor_last_seen,
      seconds_ago: meta.seconds_ago,
      battery: meta.sensor_battery,
      device_name: meta.sensor_device_name
    });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
