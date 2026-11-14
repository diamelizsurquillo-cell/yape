import {
  setCorsHeaders,
  getSupabaseClient,
  extractAuthUser,
  checkBusinessSubscription
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
  const url = (negocio?.webhook_url || '').trim();
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    await fetch(url, {
      method: 'POST',
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
  setCorsHeaders(res);

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
  // 1. REGISTRAR PAGO (DESDE APP ANDROID SENSOR O BOTÓN DE PRUEBA)
  // =========================================================================
  if (req.method === 'POST') {
    const apiKey = (req.headers['x-api-key'] || '').trim();
    const expectedMasterKey = (process.env.YAPE_API_KEY || 'mi_yape_secreto_123').trim();

    if (!apiKey) {
      return res.status(401).json({ error: 'API Key no proporcionada en cabecera X-API-Key' });
    }

    let targetNegocio = null;
    let isMasterAccount = false;

    // 1A. Buscar si la API Key pertenece a un cliente suscriptor en tabla 'negocios'
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
    } else if (apiKey === expectedMasterKey) {
      isMasterAccount = true;
    } else {
      return res.status(401).json({ error: 'API Key inválida o negocio no registrado' });
    }

    const { remitente, monto, timestamp, codigo_seguridad, banco } = req.body || {};

    if (!remitente || monto === undefined || !timestamp) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: remitente, monto, timestamp' });
    }

    const bankName = (banco || 'YAPE').toUpperCase();
    const codSeguridad = codigo_seguridad || (bankName === 'BBVA' ? 'BBVA' : null);

    const payload = {
      remitente: String(remitente).trim(),
      monto: parseFloat(monto),
      timestamp: parseInt(timestamp),
      codigo_seguridad: codSeguridad,
      banco: bankName,
      validado: 0,
      ...(targetNegocio ? { negocio_id: targetNegocio.id } : {})
    };

    let { data, error } = await supabase
      .from('pagos')
      .insert([payload])
      .select()
      .single();

    // Retrocompatibilidad si aún no se ejecutó supabase_saas_migration.sql
    if (error && error.message) {
      const lowerMsg = error.message.toLowerCase();
      if (lowerMsg.includes('negocio_id') || lowerMsg.includes('banco')) {
        const fallbackPayload = {
          remitente: String(remitente).trim(),
          monto: parseFloat(monto),
          timestamp: parseInt(timestamp),
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

    // Disparar Webhook si el negocio tiene integración configurada (WooCommerce / Facturador)
    if (targetNegocio && targetNegocio.webhook_url) {
      await dispatchWebhookIfConfigured(targetNegocio, finalPago);
    }

    return res.status(201).json({
      mensaje: 'Pago registrado exitosamente',
      negocio: targetNegocio ? targetNegocio.nombre_comercial : isMasterAccount ? 'Cuenta Principal' : '',
      pago: finalPago
    });
  }

  // =========================================================================
  // Para GET, PATCH y DELETE requerimos sesión válida (SuperAdmin, Dueño o Cajero)
  // =========================================================================
  const authUser = extractAuthUser(req);
  if (!authUser) {
    return res.status(401).json({ error: 'Sesión expirada o no autenticada. Inicia sesión nuevamente.' });
  }

  const isSuperAdmin = authUser.rol === 'SUPERADMIN';
  const isCajero = authUser.rol === 'CAJERO';

  // Si pertenece a un negocio cliente, verificar que su suscripción siga activa en tiempo real
  if (!isSuperAdmin && authUser.negocio_id) {
    const { data: negActual } = await supabase
      .from('negocios')
      .select('id, estado, fecha_vencimiento')
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
    }
  }

  // =========================================================================
  // 2. LISTAR PAGOS AISLADOS POR NEGOCIO Y ROL
  // =========================================================================
  if (req.method === 'GET') {
    const { negocio_id: filterNegocioId, validado, search, fecha_inicio, fecha_fin } = req.query || {};

    let query = supabase.from('pagos').select('*').order('timestamp', { ascending: false });

    if (!isSuperAdmin) {
      query = query.eq('negocio_id', authUser.negocio_id);
    } else if (filterNegocioId === 'MASTER') {
      query = query.is('negocio_id', null);
    } else if (filterNegocioId) {
      query = query.eq('negocio_id', filterNegocioId);
    }

    // Si es CAJERO, restringir estrictamente a las últimas 24 horas (pagos del turno/día)
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
      query = query.eq('validado', parseInt(validado));
    }

    if (search) {
      query = query.ilike('remitente', `%${search}%`);
    }

    let { data, error } = await query;

    // Fallback retrocompatible si aún no existe columna negocio_id en Supabase y entra SuperAdmin
    if (error && isSuperAdmin && (error.message || '').toLowerCase().includes('negocio_id')) {
      const retry = await supabase.from('pagos').select('*').order('timestamp', { ascending: false });
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json((data || []).map(enrichBankField));
  }

  // =========================================================================
  // 3. VALIDAR / MARCAR PAGO COMO ATENDIDO (CAJERO, DUEÑO O SUPERADMIN)
  // =========================================================================
  if (req.method === 'PATCH') {
    const id = req.query?.id || req.body?.id;
    const nota_pedido = req.body?.nota_pedido;

    if (!id) {
      return res.status(400).json({ error: 'ID de pago requerido para validar' });
    }

    // Verificar pertenencia del pago
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
      usuario_validador: authUser.nombre || authUser.username
    };
    if (nota_pedido !== undefined) {
      updateData.nota_pedido = String(nota_pedido).trim();
    }

    let { data: updated, error: updErr } = await supabase
      .from('pagos')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    // Fallback si faltan columnas opcionales en BD antigua
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

    // Borrado masivo del historial: SOLO del negocio actual
    if (!isSuperAdmin) {
      const { error } = await supabase
        .from('pagos')
        .delete()
        .eq('negocio_id', authUser.negocio_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ mensaje: 'Historial de tu negocio limpiado con éxito' });
    }

    // Si es SuperAdmin: puede borrar por negocio específico o todo
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
