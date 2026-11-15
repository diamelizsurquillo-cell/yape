import {
  setCorsHeaders,
  getSupabaseClient,
  extractAuthUser,
  checkBusinessSubscription,
  validateSafeWebhookUrl,
  sanitizeText,
  safeEqualStrings,
  getClientIp,
  checkRateLimit,
  verifySensorHmac,
  extractSensorMeta,
  updateSensorMetaInSupabase,
  extractPushSubscriptions,
  savePushSubscriptionsInSupabase,
  dispatchWebPushToSubs
} from './_utils.js';

function enrichBankField(p) {
  if (p.banco) return p;
  const cod = (p.codigo_seguridad || '').toUpperCase();
  const rem = p.remitente || '';
  const isBbva =
    cod === 'BBVA' ||
    cod.includes('QR-BBVA') ||
    cod.includes('QR BBVA') ||
    (cod === '' && rem === rem.toUpperCase() && rem.length > 5 && /^[A-ZÁÉÍÓÚÑ\s]+$/.test(rem));
  return { ...p, banco: isBbva ? 'BBVA' : 'YAPE' };
}

async function dispatchWebhookIfConfigured(negocio, pagoData) {
  const whCheck = validateSafeWebhookUrl(negocio?.webhook_url);
  if (!whCheck.valid || !whCheck.url) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    await fetch(whCheck.url, {
      method: 'POST',
      redirect: 'error', // Bloquear redirecciones SSRF
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Source': 'YapeMonitor-SaaS',
        'X-Tenant-Id': negocio.id
      },
      body: JSON.stringify({
        event: 'payment.received',
        negocio: negocio.nombre_comercial,
        pago: {
          id: pagoData.id,
          banco: pagoData.banco,
          monto: pagoData.monto,
          remitente: pagoData.remitente,
          codigo_seguridad: pagoData.codigo_seguridad,
          timestamp: pagoData.timestamp
        }
      }),
      signal: controller.signal
    });
  } catch (err) {
    console.warn(`Webhook falló para negocio ${negocio.id}:`, err.message);
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { supabase, hasUrl, hasKey } = getSupabaseClient();
  if (!supabase) {
    return res.status(500).json({
      error: 'Variables de entorno de Supabase no configuradas en Vercel',
      hasUrl,
      hasKey
    });
  }

  // =========================================================================
  // 1. REGISTRAR PAGO (DESDE APP ANDROID SENSOR O BOTÓN DEMO)
  // =========================================================================
  if (req.method === 'POST') {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`pagos-post:${ip}`, 45, 60 * 1000);
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return res.status(429).json({ error: 'Límite de envíos por minuto excedido.' });
    }

    const apiKey = String(req.headers['x-api-key'] || '').trim();
    const expectedMasterKey = (process.env.YAPE_API_KEY || 'mi_yape_secreto_123').trim();

    if (!apiKey) {
      return res.status(401).json({ error: 'API Key no proporcionada en cabecera X-API-Key' });
    }

    let targetNegocio = null;
    let isMasterAccount = false;

    const { data: negRow, error: negErr } = await supabase
      .from('negocios')
      .select('*')
      .eq('api_key', apiKey)
      .maybeSingle();

    if (!negErr && negRow) {
      const subCheck = checkBusinessSubscription(negRow);
      if (!subCheck.valid) {
        return res.status(402).json({
          error: subCheck.reason,
          subscription_expired: true
        });
      }
      targetNegocio = negRow;
    } else if (safeEqualStrings(apiKey, expectedMasterKey)) {
      isMasterAccount = true;
    } else {
      return res.status(401).json({ error: 'API Key inválida o negocio no registrado' });
    }

    const { remitente, monto, timestamp, codigo_seguridad, banco, event_uid } = req.body || {};

    const cleanRemitente = sanitizeText(remitente, 100);
    const cleanEventUid = sanitizeText(event_uid || '', 80);
    const numMonto = Number(monto);
    const rawTs = parseInt(timestamp, 10);

    if (!cleanRemitente || !Number.isFinite(numMonto) || numMonto <= 0 || numMonto > 50000) {
      return res.status(400).json({
        error: 'Datos de pago inválidos: verifica remitente y monto (entre S/ 0.01 y S/ 50,000).'
      });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    // Normalizar timestamp (si llega en ms, pasarlo a segundos; impedir fechas futuras absurdas)
    let safeTimestamp = Number.isFinite(rawTs) && rawTs > 0 ? rawTs : nowSec;
    if (safeTimestamp > 9999999999) {
      safeTimestamp = Math.floor(safeTimestamp / 1000);
    }

    const rawBanco = sanitizeText(banco || 'YAPE', 12).toUpperCase();
    const bankName = ['YAPE', 'PLIN', 'BBVA'].includes(rawBanco) ? rawBanco : 'YAPE';
    const codSeguridad =
      sanitizeText(codigo_seguridad, 16) || (bankName === 'BBVA' ? 'BBVA' : null);

    // Sensor v2.0: Verificación criptográfica HMAC-SHA256 por petición
    const sigHeader = req.headers['x-signature-256'];
    const reqTsHeader = req.headers['x-request-timestamp'];
    if (sigHeader) {
      const canonical = `${reqTsHeader}|${cleanEventUid}|${bankName}|${numMonto.toFixed(2)}|${safeTimestamp}|${cleanRemitente}`;
      const hmacCheck = verifySensorHmac({
        apiKey,
        reqTimestamp: reqTsHeader,
        canonicalMessage: canonical,
        signatureHex: sigHeader
      });
      if (!hmacCheck.verified) {
        return res.status(401).json({ error: hmacCheck.error });
      }
    }

    if (safeTimestamp > nowSec + 300) {
      safeTimestamp = nowSec;
    }

    // 1) Deduplicación exacta por event_uid determinístico (Sensor v2.0)
    if (cleanEventUid) {
      try {
        let uidQuery = supabase.from('pagos').select('*').eq('event_uid', cleanEventUid).limit(1);
        if (targetNegocio) uidQuery = uidQuery.eq('negocio_id', targetNegocio.id);
        const { data: exactMatch, error: uidErr } = await uidQuery;
        if (!uidErr && exactMatch && exactMatch.length > 0) {
          return res.status(200).json({
            mensaje: 'Pago ya registrado previamente (idempotencia event_uid)',
            duplicate_ignored: true,
            pago: exactMatch[0]
          });
        }
      } catch {
        // Si aún no agregaron columna event_uid, cae al filtro temporal de 20s
      }
    }

    // 2) Protección Anti-Duplicados / Anti-Replay temporal (ventana de 20 segundos)
    try {
      let dupQuery = supabase
        .from('pagos')
        .select('*')
        .eq('remitente', cleanRemitente)
        .eq('monto', Math.round(numMonto * 100) / 100)
        .gte('timestamp', safeTimestamp - 20)
        .limit(1);

      if (targetNegocio) {
        dupQuery = dupQuery.eq('negocio_id', targetNegocio.id);
      } else {
        dupQuery = dupQuery.is('negocio_id', null);
      }

      const { data: recentDups } = await dupQuery;
      if (recentDups && recentDups.length > 0) {
        const existingCod = recentDups[0].codigo_seguridad || null;
        if (existingCod === codSeguridad) {
          return res.status(200).json({
            mensaje: 'Pago duplicado ignorado de forma segura',
            duplicate_ignored: true,
            pago: recentDups[0]
          });
        }
      }
    } catch {
      // Continuar si el chequeo opcional no aplica
    }

    const payload = {
      remitente: cleanRemitente,
      monto: Math.round(numMonto * 100) / 100,
      timestamp: safeTimestamp,
      codigo_seguridad: codSeguridad,
      banco: bankName,
      validado: 0,
      ...(cleanEventUid ? { event_uid: cleanEventUid } : {}),
      ...(targetNegocio ? { negocio_id: targetNegocio.id } : {})
    };

    let { data, error } = await supabase
      .from('pagos')
      .insert([payload])
      .select()
      .single();

    if (error && error.message) {
      const lowerMsg = error.message.toLowerCase();
      if (lowerMsg.includes('event_uid')) {
        const { event_uid: _omit, ...withoutUid } = payload;
        const retryUid = await supabase.from('pagos').insert([withoutUid]).select().single();
        data = retryUid.data;
        error = retryUid.error;
      } else if (lowerMsg.includes('negocio_id') || lowerMsg.includes('banco')) {
        const fallbackPayload = {
          remitente: cleanRemitente,
          monto: payload.monto,
          timestamp: safeTimestamp,
          codigo_seguridad: codSeguridad,
          validado: 0
        };
        const retry = await supabase.from('pagos').insert([fallbackPayload]).select().single();
        data = retry.data ? { ...retry.data, banco: bankName, negocio_id: targetNegocio?.id || null } : null;
        error = retry.error;
      }
    }

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const finalPago = data || { ...payload, id: Date.now() };

    if (targetNegocio) {
      await updateSensorMetaInSupabase(supabase, targetNegocio, {
        sensor_last_seen: new Date().toISOString()
      });
      if (targetNegocio.webhook_url) {
        await dispatchWebhookIfConfigured(targetNegocio, finalPago);
      }

      // Enviar Notificación Web Push instantánea a Cajeros/Dueño aunque tengan la App PWA cerrada o pantalla bloqueada
      const pushSubs = extractPushSubscriptions(targetNegocio);
      if (pushSubs.length > 0) {
        try {
          const montoStr = Number(finalPago.monto || 0).toFixed(2);
          const codTxt = finalPago.codigo_seguridad ? ` • Cód: ${finalPago.codigo_seguridad}` : '';
          const pushRes = await dispatchWebPushToSubs(pushSubs, {
            title: `💸 ${bankName} RECIBIDO: S/ ${montoStr}`,
            body: `De: ${finalPago.remitente}${codTxt}`,
            id: finalPago.id,
            monto: finalPago.monto,
            remitente: finalPago.remitente,
            codigo_seguridad: finalPago.codigo_seguridad,
            banco: bankName,
            tag: `pago-${finalPago.id || Date.now()}`,
            url: '/'
          });
          if (pushRes.pruned) {
            await savePushSubscriptionsInSupabase(supabase, targetNegocio, pushRes.validSubs);
          }
        } catch (pushErr) {
          console.warn('Error enviando Web Push:', pushErr.message);
        }
      }
    }

    return res.status(201).json({
      mensaje: 'Pago registrado exitosamente',
      negocio: targetNegocio ? targetNegocio.nombre_comercial : isMasterAccount ? 'Cuenta Principal' : '',
      pago: finalPago
    });
  }

  // =========================================================================
  // 1B. POLLING AUTENTICADO PARA RECEPTOR DE ESCRITORIO WINDOWS (vía X-API-Key)
  // Permite que desktop/yape-desktop.js funcione SIN llaves de Supabase expuestas
  // =========================================================================
  if (req.method === 'GET' && req.query?.modo === 'desktop_poll') {
    const apiKey = String(req.headers['x-api-key'] || '').trim();
    if (!apiKey) return res.status(401).json({ error: 'X-API-Key requerida' });

    const expectedMasterKey = (process.env.YAPE_API_KEY || 'mi_yape_secreto_123').trim();
    let targetNegocio = null;

    if (!safeEqualStrings(apiKey, expectedMasterKey)) {
      const { data: negRow } = await supabase
        .from('negocios')
        .select('id, nombre_comercial, estado, fecha_vencimiento')
        .eq('api_key', apiKey)
        .maybeSingle();

      if (!negRow) return res.status(401).json({ error: 'API Key inválida' });
      const sub = checkBusinessSubscription(negRow);
      if (!sub.valid) return res.status(403).json({ error: sub.reason });
      targetNegocio = negRow;
    }

    const sinceSec = parseInt(req.query.since || '0', 10) || Math.floor(Date.now() / 1000) - 60;
    let q = supabase
      .from('pagos')
      .select('id, remitente, monto, timestamp, codigo_seguridad, banco, validado')
      .gte('timestamp', sinceSec)
      .order('id', { ascending: true })
      .limit(20);

    if (targetNegocio) {
      q = q.eq('negocio_id', targetNegocio.id);
    }

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({
      negocio: targetNegocio ? targetNegocio.nombre_comercial : 'Modo Principal',
      pagos: (data || []).map(enrichBankField)
    });
  }

  // =========================================================================
  // Para GET, PATCH y DELETE del Dashboard Web requerimos sesión JWT válida
  // =========================================================================
  const authUser = extractAuthUser(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Sesión expirada o no autenticada. Inicia sesión nuevamente.' });
  }

  const isSuperAdmin = authUser.rol === 'SUPERADMIN';
  const isCajero = authUser.rol === 'CAJERO';

  let activeSensorMeta = null;

  if (!isSuperAdmin && authUser.negocio_id) {
    const { data: negActual } = await supabase
      .from('negocios')
      .select('*')
      .eq('id', authUser.negocio_id)
      .maybeSingle();

    if (negActual) {
      const subCheck = checkBusinessSubscription(negActual);
      if (!subCheck.valid) {
        return res.status(403).json({
          error: subCheck.reason,
          subscription_expired: true
        });
      }
      activeSensorMeta = extractSensorMeta(negActual);
    }
  } else if (isSuperAdmin && req.query?.negocio_id && req.query.negocio_id !== 'MASTER') {
    const { data: negFiltered } = await supabase
      .from('negocios')
      .select('*')
      .eq('id', req.query.negocio_id)
      .maybeSingle();
    if (negFiltered) {
      activeSensorMeta = extractSensorMeta(negFiltered);
    }
  }

  if (activeSensorMeta) {
    res.setHeader(
      'X-Sensor-Status',
      JSON.stringify({
        online: activeSensorMeta.online,
        battery: activeSensorMeta.sensor_battery,
        seconds_ago: activeSensorMeta.seconds_ago,
        device_name: activeSensorMeta.sensor_device_name
      })
    );
  }

  // =========================================================================
  // 2. LISTAR PAGOS AISLADOS POR NEGOCIO Y ROL
  // =========================================================================
  if (req.method === 'GET') {
    const { negocio_id: filterNegocioId, validado, search, fecha_inicio, fecha_fin, limit } = req.query || {};
    const maxRows = Math.max(1, Math.min(500, parseInt(limit || '500', 10) || 500));

    let query = supabase.from('pagos').select('*').order('timestamp', { ascending: false }).limit(maxRows);

    if (!isSuperAdmin) {
      query = query.eq('negocio_id', authUser.negocio_id);
    } else if (filterNegocioId === 'MASTER') {
      query = query.is('negocio_id', null);
    } else if (filterNegocioId) {
      query = query.eq('negocio_id', filterNegocioId);
    }

    if (isCajero) {
      const hace24hEpoch = Math.floor(Date.now() / 1000) - 86400;
      query = query.gte('timestamp', hace24hEpoch);
    } else {
      if (fecha_inicio) {
        const startEpoch = Math.floor(new Date(`${fecha_inicio}T00:00:00`).getTime() / 1000);
        if (!isNaN(startEpoch)) query = query.gte('timestamp', startEpoch);
      }
      if (fecha_fin) {
        const endEpoch = Math.floor(new Date(`${fecha_fin}T23:59:59`).getTime() / 1000);
        if (!isNaN(endEpoch)) query = query.lte('timestamp', endEpoch);
      }
    }

    if (validado !== undefined && validado !== '') {
      query = query.eq('validado', parseInt(validado, 10) === 1 ? 1 : 0);
    }

    if (search) {
      query = query.ilike('remitente', `%${sanitizeText(search, 60)}%`);
    }

    let { data, error } = await query;

    if (error && isSuperAdmin && (error.message || '').toLowerCase().includes('negocio_id')) {
      const retry = await supabase.from('pagos').select('*').order('timestamp', { ascending: false }).limit(500);
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json((data || []).map(enrichBankField));
  }

  // =========================================================================
  // 3. VALIDAR PAGO
  // =========================================================================
  if (req.method === 'PATCH') {
    const id = req.query?.id || req.body?.id;
    const nota_pedido = req.body?.nota_pedido;

    if (!id) {
      return res.status(400).json({ error: 'ID de pago requerido para validar' });
    }

    const { data: pagoExistente, error: findErr } = await supabase
      .from('pagos')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (findErr || !pagoExistente) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    if (!isSuperAdmin && pagoExistente.negocio_id !== authUser.negocio_id) {
      return res.status(403).json({ error: 'No tienes acceso a este pago' });
    }

    const updateData = {
      validado: 1,
      fecha_validacion: new Date().toISOString(),
      usuario_validador: sanitizeText(authUser.nombre || authUser.username, 60)
    };
    if (nota_pedido !== undefined) {
      updateData.nota_pedido = sanitizeText(nota_pedido, 120);
    }

    let { data: updated, error: updErr } = await supabase
      .from('pagos')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updErr && updErr.message) {
      const retry = await supabase
        .from('pagos')
        .update({ validado: 1 })
        .eq('id', id)
        .select()
        .single();
      updated = retry.data
        ? {
            ...retry.data,
            fecha_validacion: updateData.fecha_validacion,
            usuario_validador: updateData.usuario_validador
          }
        : null;
      updErr = retry.error;
    }

    if (updErr) {
      return res.status(500).json({ error: updErr.message });
    }

    return res.status(200).json({
      mensaje: 'Pago validado con éxito',
      pago: enrichBankField(updated)
    });
  }

  // =========================================================================
  // 4. ELIMINAR PAGOS (BLOQUEADO PARA CAJEROS, AISLADO POR NEGOCIO)
  // =========================================================================
  if (req.method === 'DELETE') {
    if (isCajero) {
      return res.status(403).json({
        error: 'Acceso denegado: El perfil de Cajero no puede eliminar registros de pagos.'
      });
    }

    const { id, negocio_id: targetNegId } = req.query || {};

    if (id) {
      let delQuery = supabase.from('pagos').delete().eq('id', id);
      if (!isSuperAdmin) {
        delQuery = delQuery.eq('negocio_id', authUser.negocio_id);
      }
      const { error } = await delQuery;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ mensaje: `Pago ${id} eliminado` });
    }

    if (!isSuperAdmin) {
      const { error } = await supabase
        .from('pagos')
        .delete()
        .eq('negocio_id', authUser.negocio_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ mensaje: 'Historial de tu negocio limpiado con éxito' });
    }

    if (targetNegId && targetNegId !== 'ALL') {
      const q =
        targetNegId === 'MASTER'
          ? supabase.from('pagos').delete().is('negocio_id', null)
          : supabase.from('pagos').delete().eq('negocio_id', targetNegId);
      const { error } = await q;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ mensaje: 'Historial filtrado eliminado con éxito' });
    }

    let { error } = await supabase.from('pagos').delete().not('id', 'is', null);
    if (error) {
      const fallback = await supabase.from('pagos').delete().gte('timestamp', 0);
      error = fallback.error;
    }
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ mensaje: 'Historial eliminado con éxito' });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
