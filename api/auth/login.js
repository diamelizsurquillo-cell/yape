import {
  setCorsHeaders,
  getSupabaseClient,
  signJwt,
  checkBusinessSubscription,
  getClientIp,
  checkRateLimit,
  safeEqualStrings,
  verifyPasswordTimingSafe,
  encryptSecret
} from '../_utils.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Protección contra fuerza bruta por IP (máx 10 intentos cada 5 minutos)
  const ip = getClientIp(req);
  const rl = checkRateLimit(`login:${ip}`, 10, 5 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({
      error: `Demasiados intentos de inicio de sesión. Intenta nuevamente en ${rl.retryAfterSec} segundos.`
    });
  }

  const rawUser = String(req.body?.username || '').trim().slice(0, 64);
  const rawPass = String(req.body?.password || '').slice(0, 128);

  if (!rawUser || !rawPass) {
    return res.status(400).json({ error: 'Ingresa tu usuario y contraseña' });
  }

  const expectedSuperUser = (process.env.DASHBOARD_USERNAME || 'admin').trim();
  const expectedSuperPass = process.env.DASHBOARD_PASSWORD || 'yape1234';

  // 1. Acceso Maestro SUPERADMIN (Comparación en tiempo constante, sin incluir api_key en JWT)
  if (
    safeEqualStrings(rawUser.toLowerCase(), expectedSuperUser.toLowerCase()) &&
    safeEqualStrings(rawPass, expectedSuperPass)
  ) {
    const jwtClaims = {
      id: 'superadmin',
      username: expectedSuperUser,
      nombre: 'Super Administrador',
      rol: 'SUPERADMIN',
      negocio_id: null,
      nombre_comercial: 'Administración Central SaaS',
      plan: 'ILIMITADO'
    };
    const token = signJwt(jwtClaims);
    return res.status(200).json({
      success: true,
      mensaje: 'Bienvenido Super Administrador',
      token,
      user: jwtClaims
    });
  }

  // 2. Acceso Multi-Empresa (Dueño de Negocio o Cajero) en Supabase
  const { supabase } = getSupabaseClient();
  if (!supabase) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  try {
    const { data: usuario, error: userErr } = await supabase
      .from('usuarios_negocio')
      .select('*')
      .ilike('username', rawUser)
      .maybeSingle();

    if (userErr) {
      if (userErr.message && userErr.message.toLowerCase().includes('usuarios_negocio')) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }
      return res.status(500).json({ error: 'Error de verificación de usuario' });
    }

    if (!usuario || !verifyPasswordTimingSafe(usuario.password, rawPass)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    // Migración transparente: si la contraseña antigua estaba en texto plano, cifrarla en reposo con AES-256-GCM
    if (usuario.password && !String(usuario.password).startsWith('enc:v1:')) {
      await supabase
        .from('usuarios_negocio')
        .update({ password: encryptSecret(rawPass) })
        .eq('id', usuario.id);
    }

    if (usuario.activo === false) {
      return res.status(403).json({
        error: 'Tu usuario ha sido desactivado por el administrador del negocio.'
      });
    }

    const { data: negocio, error: negErr } = await supabase
      .from('negocios')
      .select('*')
      .eq('id', usuario.negocio_id)
      .maybeSingle();

    if (negErr || !negocio) {
      return res.status(403).json({ error: 'No se encontró una empresa activa asociada a tu usuario.' });
    }

    const subStatus = checkBusinessSubscription(negocio);
    if (!subStatus.valid) {
      return res.status(403).json({
        error: subStatus.reason,
        subscription_expired: true
      });
    }

    const rol = (usuario.rol || 'DUENO').toUpperCase();
    // JAMÁS incluimos api_key dentro del JWT almacenado en localStorage (SEC-06)
    const jwtClaims = {
      id: usuario.id,
      username: usuario.username,
      nombre: usuario.nombre_mostrar || usuario.username,
      rol,
      negocio_id: negocio.id,
      nombre_comercial: negocio.nombre_comercial,
      plan: negocio.plan || 'MENSUAL',
      fecha_vencimiento: negocio.fecha_vencimiento,
      ...(rol === 'DUENO'
        ? {
            whatsapp_alerta: negocio.whatsapp_alerta || ''
          }
        : {})
    };

    const token = signJwt(jwtClaims);
    return res.status(200).json({
      success: true,
      mensaje: 'Autenticación exitosa',
      token,
      user: jwtClaims
    });
  } catch {
    return res.status(500).json({ error: 'Error interno de autenticación' });
  }
}
