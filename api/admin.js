import {
  setCorsHeaders,
  getSupabaseClient,
  extractAuthUser,
  generateTenantApiKey
} from './_utils.js';

export default async function handler(req, res) {
  setCorsHeaders(res);

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

  const { supabase, hasUrl, hasKey } = getSupabaseClient();
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

        // Contar pagos por negocio de forma ligera
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
          usuarios: (usuarios || []).filter((u) => u.negocio_id === neg.id),
          total_pagos: conteoPorNegocio[neg.id] || 0,
          volumen_soles: montoPorNegocio[neg.id] || 0
        }));

        return res.status(200).json({
          schemaReady: true,
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
        usuarios: misUsuarios || []
      });
    }

    // =====================================================================
    // 2. POST: Crear Negocio Completo (SuperAdmin) o Crear Cajero/Usuario
    // =====================================================================
    if (req.method === 'POST') {
      const body = req.body || {};
      const action = body.action || 'create_negocio';

      // Crear nuevo cliente/negocio (Exclusivo SuperAdmin)
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

        if (!nombre_comercial || !dueno_username || !dueno_password) {
          return res.status(400).json({
            error: 'Nombre comercial, usuario del dueño y contraseña del dueño son obligatorios.'
          });
        }

        // Validar que no exista el username
        const usernamesToCheck = [dueno_username.trim()];
        if (cajero_username && cajero_username.trim()) {
          usernamesToCheck.push(cajero_username.trim());
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

        const dias = Math.max(1, parseInt(dias_vigencia) || 30);
        const fechaVencimiento = new Date(Date.now() + dias * 86400 * 1000).toISOString();
        const apiKey = generateTenantApiKey();

        const { data: nuevoNegocio, error: negError } = await supabase
          .from('negocios')
          .insert([
            {
              nombre_comercial: nombre_comercial.trim(),
              ruc_o_telefono: ruc_o_telefono.trim(),
              api_key: apiKey,
              plan,
              precio_plan: parseFloat(precio_plan) || 0,
              estado: 'ACTIVO',
              fecha_vencimiento: fechaVencimiento,
              webhook_url: webhook_url.trim(),
              whatsapp_alerta: whatsapp_alerta.trim(),
              notas_admin: notas_admin.trim()
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
            username: dueno_username.trim(),
            password: dueno_password,
            nombre_mostrar: `Dueño - ${nombre_comercial.trim()}`,
            rol: 'DUENO',
            activo: true
          }
        ];

        if (cajero_username && cajero_username.trim() && cajero_password) {
          usersToInsert.push({
            negocio_id: nuevoNegocio.id,
            username: cajero_username.trim(),
            password: cajero_password,
            nombre_mostrar: `Caja - ${nombre_comercial.trim()}`,
            rol: 'CAJERO',
            activo: true
          });
        }

        const { data: creados, error: usrErr } = await supabase
          .from('usuarios_negocio')
          .insert(usersToInsert)
          .select();

        if (usrErr) {
          // Revertir negocio si falló la creación de usuario
          await supabase.from('negocios').delete().eq('id', nuevoNegocio.id);
          return res.status(500).json({ error: usrErr.message });
        }

        return res.status(201).json({
          mensaje: 'Cliente registrado exitosamente',
          negocio: {
            ...nuevoNegocio,
            usuarios: creados || [],
            total_pagos: 0,
            volumen_soles: 0
          }
        });
      }

      // Crear usuario adicional (Cajero o Dueño)
      if (action === 'create_usuario') {
        const targetNegocioId = isSuperAdmin ? body.negocio_id : authUser.negocio_id;
        const rolSolicitado = isSuperAdmin ? (body.rol || 'CAJERO').toUpperCase() : 'CAJERO';
        const { username, password, nombre_mostrar } = body;

        if (!targetNegocioId || !username || !password) {
          return res.status(400).json({ error: 'Faltan datos obligatorios del usuario' });
        }

        const { data: existe } = await supabase
          .from('usuarios_negocio')
          .select('id')
          .ilike('username', username.trim())
          .maybeSingle();

        if (existe) {
          return res.status(409).json({ error: 'Ese nombre de usuario ya está ocupado' });
        }

        const { data: nuevoUsuario, error } = await supabase
          .from('usuarios_negocio')
          .insert([
            {
              negocio_id: targetNegocioId,
              username: username.trim(),
              password,
              nombre_mostrar: (nombre_mostrar || username).trim(),
              rol: rolSolicitado,
              activo: true
            }
          ])
          .select()
          .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ mensaje: 'Usuario creado con éxito', usuario: nuevoUsuario });
      }

      return res.status(400).json({ error: 'Acción POST desconocida' });
    }

    // =====================================================================
    // 3. PATCH: Renovar Plan, Suspender/Activar, Regenerar API Key, Ajustes
    // =====================================================================
    if (req.method === 'PATCH') {
      const body = req.body || {};
      const { action } = body;

      // Renovar días de suscripción (SuperAdmin)
      if (action === 'extend_plan') {
        if (!isSuperAdmin) return res.status(403).json({ error: 'No autorizado' });
        const { negocio_id, dias = 30, plan } = body;

        const { data: neg } = await supabase
          .from('negocios')
          .select('*')
          .eq('id', negocio_id)
          .single();

        if (!neg) return res.status(404).json({ error: 'Negocio no encontrado' });

        const currentExp = neg.fecha_vencimiento ? new Date(neg.fecha_vencimiento).getTime() : Date.now();
        const baseTime = currentExp > Date.now() ? currentExp : Date.now();
        const nuevaFecha = new Date(baseTime + Number(dias) * 86400 * 1000).toISOString();

        const updates = {
          fecha_vencimiento: nuevaFecha,
          estado: 'ACTIVO'
        };
        if (plan) updates.plan = plan;

        const { data: updated, error } = await supabase
          .from('negocios')
          .update(updates)
          .eq('id', negocio_id)
          .select()
          .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ mensaje: `Suscripción extendida +${dias} días`, negocio: updated });
      }

      // Suspender o Activar negocio (SuperAdmin)
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

      // Regenerar API Key del negocio (SuperAdmin o Dueño de su propio negocio)
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

      // Actualizar Webhook, WhatsApp o datos del negocio
      if (action === 'update_settings') {
        const targetId = isSuperAdmin ? (body.negocio_id || authUser.negocio_id) : authUser.negocio_id;
        const updates = {};
        if (body.webhook_url !== undefined) updates.webhook_url = body.webhook_url.trim();
        if (body.whatsapp_alerta !== undefined) updates.whatsapp_alerta = body.whatsapp_alerta.trim();
        if (isSuperAdmin) {
          if (body.nombre_comercial !== undefined) updates.nombre_comercial = body.nombre_comercial.trim();
          if (body.ruc_o_telefono !== undefined) updates.ruc_o_telefono = body.ruc_o_telefono.trim();
          if (body.precio_plan !== undefined) updates.precio_plan = parseFloat(body.precio_plan) || 0;
          if (body.notas_admin !== undefined) updates.notas_admin = body.notas_admin;
          if (body.fecha_vencimiento !== undefined) updates.fecha_vencimiento = body.fecha_vencimiento;
        }

        const { data: updated, error } = await supabase
          .from('negocios')
          .update(updates)
          .eq('id', targetId)
          .select()
          .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ mensaje: 'Configuración guardada', negocio: updated });
      }

      // Cambiar clave o estado de un usuario (SuperAdmin o Dueño sobre sus cajeros)
      if (action === 'update_usuario') {
        const { usuario_id, password, activo, nombre_mostrar } = body;
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
        if (password) updates.password = password;
        if (activo !== undefined) updates.activo = Boolean(activo);
        if (nombre_mostrar) updates.nombre_mostrar = nombre_mostrar.trim();

        const { data: updated, error } = await supabase
          .from('usuarios_negocio')
          .update(updates)
          .eq('id', usuario_id)
          .select()
          .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ mensaje: 'Usuario actualizado', usuario: updated });
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
