import {
  setCorsHeaders,
  getSupabaseClient,
  signJwt,
  checkBusinessSubscription
} from '../_utils.js';

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const rawUser = (req.body?.username || '').trim();
  const rawPass = req.body?.password || '';

  if (!rawUser || !rawPass) {
    return res.status(400).json({ error: 'Ingresa tu usuario y contraseña' });
  }

  const expectedSuperUser = (process.env.DASHBOARD_USERNAME || 'admin').trim();
  const expectedSuperPass = process.env.DASHBOARD_PASSWORD || 'yape1234';

  // 1. Acceso Maestro SUPERADMIN (Dueño de la plataforma SaaS)
  if (rawUser.toLowerCase() === expectedSuperUser.toLowerCase() && rawPass === expectedSuperPass) {
    const userProfile = {
      id: 'superadmin',
      username: expectedSuperUser,
      nombre: 'Super Administrador',
      rol: 'SUPERADMIN',
      negocio_id: null,
      nombre_comercial: 'Administración Central SaaS',
      plan: 'ILIMITADO',
      api_key: process.env.YAPE_API_KEY || 'mi_yape_secreto_123'
    };
    const token = signJwt(userProfile);
    return res.status(200).json({
      success: true,
      mensaje: 'Bienvenido Super Administrador',
      token,
      user: userProfile
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
      // Si la tabla usuarios_negocio aún no fue creada
      if (userErr.message && userErr.message.toLowerCase().includes('usuarios_negocio')) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }
      return res.status(500).json({ error: userErr.message });
    }

    if (!usuario || usuario.password !== rawPass) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    if (usuario.activo === false) {
      return res.status(403).json({
        error: 'Tu usuario ha sido desactivado por el administrador del negocio.'
      });
    }

    // Consultar el negocio asociado y validar su suscripción
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
    const userProfile = {
      id: usuario.id,
      username: usuario.username,
      nombre: usuario.nombre_mostrar || usuario.username,
      rol,
      negocio_id: negocio.id,
      nombre_comercial: negocio.nombre_comercial,
      plan: negocio.plan || 'MENSUAL',
      fecha_vencimiento: negocio.fecha_vencimiento,
      // Solo el dueño del negocio ve la API Key, Webhook y configuración sensible
      ...(rol === 'DUENO'
        ? {
            api_key: negocio.api_key,
            webhook_url: negocio.webhook_url || '',
            whatsapp_alerta: negocio.whatsapp_alerta || ''
          }
        : {})
    };

    const token = signJwt(userProfile);
    return res.status(200).json({
      success: true,
      mensaje: 'Autenticación exitosa',
      token,
      user: userProfile
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Error interno de autenticación' });
  }
}
