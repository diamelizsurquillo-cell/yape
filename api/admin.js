import {
  setCorsHeaders,
  getSupabaseClient,
  extractAuthUser,
  generateTenantApiKey,
  encryptSecret,
  decryptSecret,
  validateSafeWebhookUrl,
  sanitizeText,
  getSecurityPosture
} from './_utils.js';

function mapUserForAdmin(u) {
  return {
    ...u,
    password: decryptSecret(u.password)
  };
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authUser = extractAuthUser(req);
  if (!authUser) {
    return res.status(401).json({ error: 'No autenticado o sesión expirada' });
  }

  const isSuperAdmin = authUser.rol === 'SUPERADMIN';
  const isDueno = authUser.rol === 'DUENO';

  if (!isSuperAdmin && !isDueno) {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }

  const { supabase, hasUrl, hasKey, usingServiceRole } = getSupabaseClient();
  if (!supabase) {
    return res.status(500).json({
      error: 'Supabase no está configurado en las variables de entorno',
      hasUrl,
      hasKey
    });
  }

  try {
    // =====================================================================
    // 1. GET: Listar Negocios y Usuarios (SuperAdmin) o Configuración Propia (Dueño)
    // =====================================================================
    if (req.method === 'GET') {
      if (isSuperAdmin) {
        const { data: negocios, error: negErr } = await supabase
          .from('negocios')
          .select('*')
          .order('created_at', { ascending: false });

        if (negErr) {
          const msg = (negErr.message || '').toLowerCase();
          if (msg.includes('negocios') || msg.includes('does not exist') || msg.includes('schema cache')) {
            return res.status(200).json({
              schemaReady: false,
              usingServiceRole,
              negocios: [],
              mensaje: 'Falta ejecutar el script SQL Multi-Empresa en Supabase.'
            });
          }
          return res.status(500).json({ error: negErr.message });
        }

        const { data: usuarios } = await supabase
          .from('usuarios_negocio')
          .select('*')
          .order('created_at', { ascending: true });

        // Migrar silenciosamente cualquier clave antigua en texto plano a AES-256-GCM
        for (const u of usuarios || []) {
          if (u.password && !String(u.password).startsWith('enc:v1:')) {
            await supabase
              .from('usuarios_negocio')
              .update({ password: encryptSecret(u.password) })
              .eq('id', u.id);
          }
        }

        const { data: pagosResumen } = await supabase
          .from('pagos')
          .select('negocio_id, monto');

        const conteoPorNegocio = {};
        const montoPorNegocio = {};
        (pagosResumen || []).forEach((p) => {
          if (!p.negocio_id) return;
          conteoPorNegocio[p.negocio_id] = (conteoPorNegocio[p.negocio_id] || 0) + 1;
          montoPorNegocio[p.negocio_id] = (montoPorNegocio[p.negocio_id] || 0) + Number(p.monto || 0);
        });

        const enriched = (negocios || []).map((neg) => ({
          ...neg,
          usuarios: (usuarios || [])
            .filter((u) => u.negocio_id === neg.id)
            .map(mapUserForAdmin),
          total_pagos: conteoPorNegocio[neg.id] || 0,
          volumen_soles: montoPorNegocio[neg.id] || 0
        }));

        return res.status(200).json({
          schemaReady: true,
          usingServiceRole,
          securityPosture: getSecurityPosture(),
          negocios: enriched
        });
      }

      // Vista DUEÑO: devuelve solo su propio negocio y sus cajeros
      const { data: miNegocio, error: miErr } = await supabase
        .from('negocios')
        .select('*')
        .eq('id', authUser.negocio_id)
        .single();

      if (miErr || !miNegocio) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
      }

      const { data: misUsuarios } = await supabase
        .from('usuarios_negocio')
        .select('id, username, password, nombre_mostrar, rol, activo, created_at')
        .eq('negocio_id', authUser.negocio_id)
        .order('created_at', { ascending: true });

      return res.status(200).json({
        schemaReady: true,
        negocio: miNegocio,
        usuarios: (misUsuarios || []).map(mapUserForAdmin)
      });
    }

    // =====================================================================
    // 2. POST: Crear Negocio Completo (SuperAdmin) o Crear Cajero/Usuario
    // =====================================================================
    if (req.method === 'POST') {
      const body = req.body || {};
      const action = body.action || 'create_negocio';

      if (action === 'create_negocio') {
        if (!isSuperAdmin) {
          return res.status(403).json({ error: 'Solo el SuperAdmin puede registrar empresas' });
        }

        const {
          nombre_comercial,
          ruc_o_telefono = '',
          plan = 'MENSUAL',
          dias_vigencia = 30,
          precio_plan = 29.90,
          dueno_username,
          dueno_password,
          cajero_username,
          cajero_password,
          webhook_url = '',
          whatsapp_alerta = '',
          notas_admin = ''
        } = body;

        const cleanNombre = sanitizeText(nombre_comercial, 100);
        const cleanDuenoUser = sanitizeText(dueno_username, 50);

        if (!cleanNombre || !cleanDuenoUser || !dueno_password) {
          return res.status(400).json({
            error: 'Nombre comercial, usuario del dueño y contraseña del dueño son obligatorios.'
          });
        }

        const webhookCheck = validateSafeWebhookUrl(webhook_url);
        if (!webhookCheck.valid) {
          return res.status(400).json({ error: webhookCheck.error });
        }

        const usernamesToCheck = [cleanDuenoUser];
        const cleanCajeroUser = sanitizeText(cajero_username, 50);
        if (cleanCajeroUser) {
          usernamesToCheck.push(cleanCajeroUser);
        }

        const { data: existingUsers } = await supabase
          .from('usuarios_negocio')
          .select('username')
          .in('username', usernamesToCheck);

        if (existingUsers && existingUsers.length > 0) {
          return res.status(409).json({
            error: `El nombre de usuario "${existingUsers[0].username}" ya está en uso por otro cliente.`
          });
        }

        const dias = Math.min(3650, Math.max(1, parseInt(dias_vigencia) || 30));
        const fechaVencimiento = new Date(Date.now() + dias * 86400 * 1000).toISOString();
        const apiKey = generateTenantApiKey();

        const { data: nuevoNegocio, error: negError } = await supabase
          .from('negocios')
          .insert([
            {
              nombre_comercial: cleanNombre,
              ruc_o_telefono: sanitizeText(ruc_o_telefono, 30),
              api_key: apiKey,
              plan: ['TRIAL', 'MENSUAL', 'ANUAL'].includes(plan) ? plan : 'MENSUAL',
              precio_plan: Math.max(0, parseFloat(precio_plan) || 0),
              estado: 'ACTIVO',
              fecha_vencimiento: fechaVencimiento,
              webhook_url: webhookCheck.url,
              whatsapp_alerta: sanitizeText(whatsapp_alerta, 25),
              notas_admin: sanitizeText(notas_admin, 250)
            }
          ])
          .select()
          .single();

        if (negError) {
          return res.status(500).json({ error: negError.message });
        }

        const usersToInsert = [
          {
            negocio_id: nuevoNegocio.id,
            username: cleanDuenoUser,
            password: encryptSecret(dueno_password),
            nombre_mostrar: `Dueño - ${cleanNombre}`,
            rol: 'DUENO',
            activo: true
          }
        ];

        if (cleanCajeroUser && cajero_password) {
          usersToInsert.push({
            negocio_id: nuevoNegocio.id,
            username: cleanCajeroUser,
            password: encryptSecret(cajero_password),
            nombre_mostrar: `Caja - ${cleanNombre}`,
            rol: 'CAJERO',
            activo: true
          });
        }

        const { data: creados, error: usrErr } = await supabase
          .from('usuarios_negocio')
          .insert(usersToInsert)
          .select();

        if (usrErr) {
          await supabase.from('negocios').delete().eq('id', nuevoNegocio.id);
          return res.status(500).json({ error: usrErr.message });
        }

        return res.status(201).json({
          mensaje: 'Cliente registrado exitosamente',
          negocio: {
            ...nuevoNegocio,
            usuarios: (creados || []).map(mapUserForAdmin),
            total_pagos: 0,
            volumen_soles: 0
          }
        });
      }

      if (action === 'create_usuario') {
        const targetNegocioId = isSuperAdmin ? body.negocio_id : authUser.negocio_id;
        const rolSolicitado =
          isSuperAdmin && body.rol === 'DUENO' ? 'DUENO' : 'CAJERO';
        const cleanUser = sanitizeText(body.username, 50);
        const rawPassword = String(body.password || '');

        if (!targetNegocioId || !cleanUser || !rawPassword) {
          return res.status(400).json({ error: 'Faltan datos obligatorios del usuario' });
        }

        const { data: existe } = await supabase
          .from('usuarios_negocio')
          .select('id')
          .ilike('username', cleanUser)
          .maybeSingle();

        if (existe) {
          return res.status(409).json({ error: 'Ese nombre de usuario ya está ocupado' });
        }

        const { data: nuevoUsuario, error } = await supabase
          .from('usuarios_negocio')
          .insert([
            {
              negocio_id: targetNegocioId,
              username: cleanUser,
              password: encryptSecret(rawPassword),
              nombre_mostrar: sanitizeText(body.nombre_mostrar || cleanUser, 80),
              rol: rolSolicitado,
              activo: true
            }
          ])
          .select()
          .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({
          mensaje: 'Usuario creado con éxito',
          usuario: mapUserForAdmin(nuevoUsuario)
        });
      }

      return res.status(400).json({ error: 'Acción POST desconocida' });
    }

    // =====================================================================
    // 3. PATCH: Renovar Plan, Suspender/Activar, Regenerar API Key, Ajustes
    // =====================================================================
    if (req.method === 'PATCH') {
      const body = req.body || {};
      const { action } = body;

      if (action === 'extend_plan') {
        if (!isSuperAdmin) return res.status(403).json({ error: 'No autorizado' });
        const { negocio_id, dias = 30, plan } = body;

        const { data: neg } = await supabase
          .from('negocios')
          .select('*')
          .eq('id', negocio_id)
          .single();

        if (!neg) return res.status(404).json({ error: 'Negocio no encontrado' });

        const safeDias = Math.min(3650, Math.max(1, Number(dias) || 30));
        const currentExp = neg.fecha_vencimiento ? new Date(neg.fecha_vencimiento).getTime() : Date.now();
        const baseTime = currentExp > Date.now() ? currentExp : Date.now();
        const nuevaFecha = new Date(baseTime + safeDias * 86400 * 1000).toISOString();

        const updates = {
          fecha_vencimiento: nuevaFecha,
          estado: 'ACTIVO'
        };
        if (plan && ['TRIAL', 'MENSUAL', 'ANUAL'].includes(plan)) updates.plan = plan;

        const { data: updated, error } = await supabase
          .from('negocios')
          .update(updates)
          .eq('id', negocio_id)
          .select()
          .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ mensaje: `Suscripción extendida +${safeDias} días`, negocio: updated });
      }

      if (action === 'toggle_estado') {
        if (!isSuperAdmin) return res.status(403).json({ error: 'No autorizado' });
        const { negocio_id, estado } = body;

        const { data: updated, error } = await supabase
          .from('negocios')
          .update({ estado: estado === 'SUSPENDIDO' ? 'SUSPENDIDO' : 'ACTIVO' })
          .eq('id', negocio_id)
          .select()
          .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ mensaje: 'Estado actualizado', negocio: updated });
      }

      if (action === 'regenerate_apikey') {
        const targetId = isSuperAdmin ? body.negocio_id : authUser.negocio_id;
        const newKey = generateTenantApiKey();

        const { data: updated, error } = await supabase
          .from('negocios')
          .update({ api_key: newKey })
          .eq('id', targetId)
          .select()
          .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ mensaje: 'Nueva API Key generada', api_key: newKey, negocio: updated });
      }

      if (action === 'update_settings') {
        const targetId = isSuperAdmin ? (body.negocio_id || authUser.negocio_id) : authUser.negocio_id;
        const updates = {};

        if (body.webhook_url !== undefined) {
          const whCheck = validateSafeWebhookUrl(body.webhook_url);
          if (!whCheck.valid) {
            return res.status(400).json({ error: whCheck.error });
          }
          updates.webhook_url = whCheck.url;
        }
        if (body.whatsapp_alerta !== undefined) {
          updates.whatsapp_alerta = sanitizeText(body.whatsapp_alerta, 25);
        }
        if (isSuperAdmin) {
          if (body.nombre_comercial !== undefined && sanitizeText(body.nombre_comercial, 100)) {
            updates.nombre_comercial = sanitizeText(body.nombre_comercial, 100);
          }
          if (body.ruc_o_telefono !== undefined) {
            updates.ruc_o_telefono = sanitizeText(body.ruc_o_telefono, 30);
          }
          if (body.plan && ['TRIAL', 'MENSUAL', 'ANUAL'].includes(body.plan)) {
            updates.plan = body.plan;
          }
          if (body.estado && ['ACTIVO', 'SUSPENDIDO'].includes(body.estado)) {
            updates.estado = body.estado;
          }
          if (body.precio_plan !== undefined) {
            updates.precio_plan = Math.max(0, parseFloat(body.precio_plan) || 0);
          }
          if (body.notas_admin !== undefined) {
            updates.notas_admin = sanitizeText(body.notas_admin, 250);
          }
          if (body.fecha_vencimiento) {
            updates.fecha_vencimiento = body.fecha_vencimiento;
          }
        }

        const { data: updated, error } = await supabase
          .from('negocios')
          .update(updates)
          .eq('id', targetId)
          .select()
          .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ mensaje: 'Datos del cliente actualizados', negocio: updated });
      }

      if (action === 'update_usuario') {
        const { usuario_id, username, password, rol, activo, nombre_mostrar } = body;
        const { data: targetUser } = await supabase
          .from('usuarios_negocio')
          .select('*')
          .eq('id', usuario_id)
          .single();

        if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (!isSuperAdmin && targetUser.negocio_id !== authUser.negocio_id) {
          return res.status(403).json({ error: 'No tienes permiso sobre este usuario' });
        }

        const updates = {};
        const cleanUser = username ? sanitizeText(username, 50) : '';
        if (cleanUser && cleanUser.toLowerCase() !== targetUser.username.toLowerCase()) {
          const { data: dup } = await supabase
            .from('usuarios_negocio')
            .select('id')
            .ilike('username', cleanUser)
            .neq('id', usuario_id)
            .maybeSingle();
          if (dup) {
            return res.status(409).json({ error: `El nombre de usuario "${cleanUser}" ya está ocupado.` });
          }
          updates.username = cleanUser;
        }
        if (password !== undefined && password !== '') {
          updates.password = encryptSecret(password);
        }
        if (isSuperAdmin && rol && ['DUENO', 'CAJERO'].includes(rol.toUpperCase())) {
          updates.rol = rol.toUpperCase();
        }
        if (activo !== undefined) updates.activo = Boolean(activo);
        if (nombre_mostrar) updates.nombre_mostrar = sanitizeText(nombre_mostrar, 80);

        const { data: updated, error } = await supabase
          .from('usuarios_negocio')
          .update(updates)
          .eq('id', usuario_id)
          .select()
          .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({
          mensaje: 'Usuario actualizado',
          usuario: mapUserForAdmin(updated)
        });
      }

      return res.status(400).json({ error: 'Acción PATCH desconocida' });
    }

    // =====================================================================
    // 4. DELETE: Eliminar Negocio (SuperAdmin) o Eliminar Cajero
    // =====================================================================
    if (req.method === 'DELETE') {
      const { type = 'negocio', id } = req.query || {};
      if (!id) return res.status(400).json({ error: 'ID requerido' });

      if (type === 'negocio') {
        if (!isSuperAdmin) return res.status(403).json({ error: 'Solo el SuperAdmin puede eliminar negocios' });
        const { error } = await supabase.from('negocios').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ mensaje: 'Negocio y todos sus registros eliminados' });
      }

      if (type === 'usuario') {
        const { data: targetUser } = await supabase
          .from('usuarios_negocio')
          .select('*')
          .eq('id', id)
          .single();

        if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (!isSuperAdmin && targetUser.negocio_id !== authUser.negocio_id) {
          return res.status(403).json({ error: 'No autorizado' });
        }
        if (!isSuperAdmin && targetUser.rol === 'DUENO') {
          return res.status(403).json({ error: 'No puedes eliminar la cuenta principal del dueño' });
        }

        const { error } = await supabase.from('usuarios_negocio').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ mensaje: 'Usuario eliminado' });
      }

      return res.status(400).json({ error: 'Tipo de eliminación inválido' });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Error interno en /api/admin' });
  }
}
