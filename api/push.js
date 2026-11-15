import {
  setCorsHeaders,
  getSupabaseClient,
  extractAuthUser,
  checkBusinessSubscription,
  getVapidKeys,
  validatePushSubscriptionObject,
  extractPushSubscriptions,
  savePushSubscriptionsInSupabase,
  dispatchWebPushToSubs,
  sanitizeText
} from './_utils.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authUser = extractAuthUser(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Sesión no autenticada' });
  }

  const { publicKey } = getVapidKeys();

  // 1. GET: Obtener llave pública VAPID y verificar si el endpoint actual ya está guardado en BD
  if (req.method === 'GET') {
    const { supabase } = getSupabaseClient();
    const checkEndpoint = String(req.query?.endpoint || '').trim();
    let count = 0;
    let endpointRegistered = false;

    if (supabase && authUser.negocio_id) {
      const { data: neg } = await supabase
        .from('negocios')
        .select('*')
        .eq('id', authUser.negocio_id)
        .maybeSingle();
      if (neg) {
        const subs = extractPushSubscriptions(neg);
        count = subs.length;
        if (checkEndpoint) {
          endpointRegistered = subs.some((s) => s.endpoint === checkEndpoint);
        }
      }
    }
    return res.status(200).json({
      publicKey,
      subscribedDevices: count,
      endpointRegistered
    });
  }

  const { supabase, hasUrl, hasKey } = getSupabaseClient();
  if (!supabase) {
    return res.status(500).json({
      error: 'Variables de entorno de Supabase no configuradas',
      hasUrl,
      hasKey
    });
  }

  const targetNegocioId =
    authUser.rol === 'SUPERADMIN' ? req.body?.negocio_id || authUser.negocio_id : authUser.negocio_id;

  if (!targetNegocioId) {
    return res.status(400).json({
      error: 'Inicia sesión con una cuenta de Dueño o Cajero para vincular alertas Push de un negocio.'
    });
  }

  const { data: negocio, error: negErr } = await supabase
    .from('negocios')
    .select('*')
    .eq('id', targetNegocioId)
    .maybeSingle();

  if (negErr || !negocio) {
    return res.status(404).json({ error: 'Negocio no encontrado' });
  }

  if (authUser.rol !== 'SUPERADMIN') {
    const subCheck = checkBusinessSubscription(negocio);
    if (!subCheck.valid) {
      return res.status(403).json({ error: subCheck.reason });
    }
  }

  // 2. POST: Registrar suscripción Push del Celular/PC o enviar alerta de prueba (con retardo opcional)
  if (req.method === 'POST') {
    const action = req.body?.action || 'subscribe';

    if (action === 'test') {
      const subs = extractPushSubscriptions(negocio);
      if (subs.length === 0) {
        return res.status(400).json({
          error: 'Este equipo aún no figura suscrito en el servidor. Toca "Activar Alertas" primero.'
        });
      }

      const delayMs = Math.max(0, Math.min(6000, parseInt(req.body?.delay_ms || '0', 10) || 0));
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const result = await dispatchWebPushToSubs(subs, {
        title: '💸 PRUEBA YAPE S/ 25.00',
        body: `De: Cliente de Prueba • Cód: 842 (${negocio.nombre_comercial})`,
        monto: 25.0,
        remitente: 'Cliente de Prueba',
        codigo_seguridad: '842',
        banco: 'YAPE',
        tag: `yape-test-${Date.now()}`,
        url: '/'
      });
      if (result.pruned) {
        await savePushSubscriptionsInSupabase(supabase, negocio, result.validSubs);
      }
      return res.status(200).json({
        ok: result.sentCount > 0,
        sent: result.sentCount,
        mensaje:
          result.sentCount > 0
            ? `¡Alerta Push enviada a ${result.sentCount} equipo(s)!`
            : 'El navegador rechazó el token anterior. Toca "Reactivar Alertas" para renovarlo.'
      });
    }

    const rawSub = req.body?.subscription;
    const check = validatePushSubscriptionObject(rawSub);
    if (!check.valid) {
      return res.status(400).json({ error: check.error });
    }

    const currentSubs = extractPushSubscriptions(negocio).filter(
      (s) => s.endpoint !== check.subscription.endpoint
    );

    currentSubs.push({
      ...check.subscription,
      user: sanitizeText(authUser.username || '', 40),
      rol: sanitizeText(authUser.rol || '', 20),
      created_at: new Date().toISOString()
    });

    const saved = await savePushSubscriptionsInSupabase(supabase, negocio, currentSubs);
    if (!saved.ok) {
      return res.status(500).json({
        error: `No se pudo guardar la suscripción Push en Supabase: ${saved.error?.message || 'verifica permisos RLS'}`
      });
    }

    // Enviar confirmación Push inmediata al celular para comprobar sonido + vibración
    await dispatchWebPushToSubs([check.subscription], {
      title: '🔔 ¡Alertas Activadas con Éxito!',
      body: `${negocio.nombre_comercial}: Ya recibirás aviso de cada pago aunque cierres la App.`,
      tag: `yape-welcome-${Date.now()}`,
      url: '/'
    }).catch(() => {});

    return res.status(201).json({
      ok: true,
      endpointRegistered: true,
      subscribedDevices: Math.min(15, currentSubs.length),
      mensaje: '¡Alertas con App Cerrada activadas y verificadas!'
    });
  }

  // 3. DELETE: Desactivar alertas Push de este dispositivo
  if (req.method === 'DELETE') {
    const endpoint = String(req.body?.endpoint || req.query?.endpoint || '').trim();
    const currentSubs = extractPushSubscriptions(negocio);
    const nextSubs = endpoint ? currentSubs.filter((s) => s.endpoint !== endpoint) : [];
    await savePushSubscriptionsInSupabase(supabase, negocio, nextSubs);
    return res.status(200).json({ ok: true, subscribedDevices: nextSubs.length });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
