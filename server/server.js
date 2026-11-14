require('dotenv').config();
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getDatabaseConnection } = require('./database');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PATCH', 'DELETE']
    }
});

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const YAPE_API_KEY = process.env.YAPE_API_KEY || 'mi_yape_secreto_123';
const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'yape1234';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto_token_yape_987';

function generateTenantApiKey() {
    return `yp_live_${crypto.randomBytes(12).toString('hex')}`;
}

function checkBusinessSubscription(negocio) {
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

async function verifyJwtToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Acceso denegado: Token ausente' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;

        if (decoded.rol !== 'SUPERADMIN' && decoded.negocio_id) {
            const db = await getDatabaseConnection();
            const neg = await db.get('SELECT * FROM negocios WHERE id = ?', [decoded.negocio_id]);
            const sub = checkBusinessSubscription(neg);
            if (!sub.valid) {
                return res.status(403).json({ error: sub.reason, subscription_expired: true });
            }
        }
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Token inválido o expirado' });
    }
}

function emitToTenantAndSuperAdmin(eventName, payload, negocioId) {
    io.to('role:SUPERADMIN').emit(eventName, payload);
    if (negocioId) {
        io.to(`tenant:${negocioId}`).emit(eventName, payload);
    }
}

// ==========================================
// 1. AUTENTICACIÓN MULTI-EMPRESA (/api/auth/login)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
    const rawUser = (req.body?.username || '').trim();
    const rawPass = req.body?.password || '';

    if (!rawUser || !rawPass) {
        return res.status(400).json({ error: 'Ingresa tu usuario y contraseña' });
    }

    // SuperAdmin maestro
    if (rawUser.toLowerCase() === DASHBOARD_USERNAME.toLowerCase() && rawPass === DASHBOARD_PASSWORD) {
        const userProfile = {
            id: 'superadmin',
            username: DASHBOARD_USERNAME,
            nombre: 'Super Administrador',
            rol: 'SUPERADMIN',
            negocio_id: null,
            nombre_comercial: 'Administración Central SaaS',
            plan: 'ILIMITADO',
            api_key: YAPE_API_KEY
        };
        const token = jwt.sign(userProfile, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ success: true, token, user: userProfile });
    }

    try {
        const db = await getDatabaseConnection();
        const usuario = await db.get(
            'SELECT * FROM usuarios_negocio WHERE LOWER(username) = LOWER(?)',
            [rawUser]
        );

        if (!usuario || usuario.password !== rawPass) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }

        if (!usuario.activo) {
            return res.status(403).json({ error: 'Tu usuario ha sido desactivado por el administrador.' });
        }

        const negocio = await db.get('SELECT * FROM negocios WHERE id = ?', [usuario.negocio_id]);
        if (!negocio) {
            return res.status(403).json({ error: 'Negocio asociado no encontrado.' });
        }

        const sub = checkBusinessSubscription(negocio);
        if (!sub.valid) {
            return res.status(403).json({ error: sub.reason, subscription_expired: true });
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
            ...(rol === 'DUENO'
                ? {
                      api_key: negocio.api_key,
                      webhook_url: negocio.webhook_url || '',
                      whatsapp_alerta: negocio.whatsapp_alerta || ''
                  }
                : {})
        };

        const token = jwt.sign(userProfile, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ success: true, token, user: userProfile });
    } catch (error) {
        console.error('Error en login:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// 2. PANEL SUPERADMIN Y DUEÑO (/api/admin)
// ==========================================
app.all('/api/admin', verifyJwtToken, async (req, res) => {
    const isSuperAdmin = req.user.rol === 'SUPERADMIN';
    const isDueno = req.user.rol === 'DUENO';

    if (!isSuperAdmin && !isDueno) {
        return res.status(403).json({ error: 'Acceso restringido a administradores' });
    }

    try {
        const db = await getDatabaseConnection();

        if (req.method === 'GET') {
            if (isSuperAdmin) {
                const negocios = await db.all('SELECT * FROM negocios ORDER BY created_at DESC');
                const usuarios = await db.all('SELECT * FROM usuarios_negocio ORDER BY created_at ASC');
                const resumenPagos = await db.all(
                    'SELECT negocio_id, COUNT(*) as total_pagos, COALESCE(SUM(monto), 0) as volumen_soles FROM pagos WHERE negocio_id IS NOT NULL GROUP BY negocio_id'
                );

                const statsMap = {};
                resumenPagos.forEach((r) => {
                    statsMap[r.negocio_id] = r;
                });

                const enriched = negocios.map((n) => ({
                    ...n,
                    usuarios: usuarios.filter((u) => u.negocio_id === n.id).map((u) => ({ ...u, activo: Boolean(u.activo) })),
                    total_pagos: statsMap[n.id]?.total_pagos || 0,
                    volumen_soles: statsMap[n.id]?.volumen_soles || 0
                }));

                return res.json({ schemaReady: true, negocios: enriched });
            }

            const miNegocio = await db.get('SELECT * FROM negocios WHERE id = ?', [req.user.negocio_id]);
            const misUsuarios = await db.all(
                'SELECT id, username, password, nombre_mostrar, rol, activo, created_at FROM usuarios_negocio WHERE negocio_id = ? ORDER BY created_at ASC',
                [req.user.negocio_id]
            );
            return res.json({
                schemaReady: true,
                negocio: miNegocio,
                usuarios: misUsuarios.map((u) => ({ ...u, activo: Boolean(u.activo) }))
            });
        }

        if (req.method === 'POST') {
            const body = req.body || {};
            const action = body.action || 'create_negocio';

            if (action === 'create_negocio') {
                if (!isSuperAdmin) return res.status(403).json({ error: 'Solo SuperAdmin puede crear empresas' });

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
                    return res.status(400).json({ error: 'Nombre comercial, usuario y clave del dueño son obligatorios' });
                }

                const dupDueno = await db.get('SELECT id FROM usuarios_negocio WHERE LOWER(username) = LOWER(?)', [dueno_username.trim()]);
                if (dupDueno) {
                    return res.status(409).json({ error: `El usuario "${dueno_username}" ya está registrado.` });
                }
                if (cajero_username && cajero_username.trim()) {
                    const dupCaj = await db.get('SELECT id FROM usuarios_negocio WHERE LOWER(username) = LOWER(?)', [cajero_username.trim()]);
                    if (dupCaj) {
                        return res.status(409).json({ error: `El usuario "${cajero_username}" ya está registrado.` });
                    }
                }

                const negocioId = crypto.randomUUID();
                const apiKey = generateTenantApiKey();
                const dias = Math.max(1, parseInt(dias_vigencia) || 30);
                const fechaVenc = new Date(Date.now() + dias * 86400 * 1000).toISOString();

                await db.run(
                    `INSERT INTO negocios (id, nombre_comercial, ruc_o_telefono, api_key, plan, precio_plan, estado, fecha_vencimiento, webhook_url, whatsapp_alerta, notas_admin)
                     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVO', ?, ?, ?, ?)`,
                    [
                        negocioId,
                        nombre_comercial.trim(),
                        ruc_o_telefono.trim(),
                        apiKey,
                        plan,
                        parseFloat(precio_plan) || 0,
                        fechaVenc,
                        webhook_url.trim(),
                        whatsapp_alerta.trim(),
                        notas_admin.trim()
                    ]
                );

                const duenoId = crypto.randomUUID();
                await db.run(
                    `INSERT INTO usuarios_negocio (id, negocio_id, username, password, nombre_mostrar, rol, activo)
                     VALUES (?, ?, ?, ?, ?, 'DUENO', 1)`,
                    [duenoId, negocioId, dueno_username.trim(), dueno_password, `Dueño - ${nombre_comercial.trim()}`]
                );

                if (cajero_username && cajero_username.trim() && cajero_password) {
                    const cajId = crypto.randomUUID();
                    await db.run(
                        `INSERT INTO usuarios_negocio (id, negocio_id, username, password, nombre_mostrar, rol, activo)
                         VALUES (?, ?, ?, ?, ?, 'CAJERO', 1)`,
                        [cajId, negocioId, cajero_username.trim(), cajero_password, `Caja - ${nombre_comercial.trim()}`]
                    );
                }

                const nuevoNegocio = await db.get('SELECT * FROM negocios WHERE id = ?', [negocioId]);
                const usuarios = await db.all('SELECT * FROM usuarios_negocio WHERE negocio_id = ?', [negocioId]);

                return res.status(201).json({
                    mensaje: 'Cliente registrado exitosamente',
                    negocio: {
                        ...nuevoNegocio,
                        usuarios: usuarios.map((u) => ({ ...u, activo: Boolean(u.activo) })),
                        total_pagos: 0,
                        volumen_soles: 0
                    }
                });
            }

            if (action === 'create_usuario') {
                const targetNegId = isSuperAdmin ? body.negocio_id : req.user.negocio_id;
                const rolSolicitado = isSuperAdmin ? (body.rol || 'CAJERO').toUpperCase() : 'CAJERO';
                const { username, password, nombre_mostrar } = body;

                if (!targetNegId || !username || !password) {
                    return res.status(400).json({ error: 'Faltan datos obligatorios del usuario' });
                }

                const existe = await db.get('SELECT id FROM usuarios_negocio WHERE LOWER(username) = LOWER(?)', [username.trim()]);
                if (existe) return res.status(409).json({ error: 'Ese nombre de usuario ya está ocupado' });

                const uid = crypto.randomUUID();
                await db.run(
                    `INSERT INTO usuarios_negocio (id, negocio_id, username, password, nombre_mostrar, rol, activo)
                     VALUES (?, ?, ?, ?, ?, ?, 1)`,
                    [uid, targetNegId, username.trim(), password, (nombre_mostrar || username).trim(), rolSolicitado]
                );

                const creado = await db.get('SELECT * FROM usuarios_negocio WHERE id = ?', [uid]);
                return res.status(201).json({
                    mensaje: 'Usuario creado con éxito',
                    usuario: { ...creado, activo: Boolean(creado.activo) }
                });
            }
        }

        if (req.method === 'PATCH') {
            const body = req.body || {};
            const { action } = body;

            if (action === 'extend_plan') {
                if (!isSuperAdmin) return res.status(403).json({ error: 'No autorizado' });
                const { negocio_id, dias = 30, plan } = body;
                const neg = await db.get('SELECT * FROM negocios WHERE id = ?', [negocio_id]);
                if (!neg) return res.status(404).json({ error: 'Negocio no encontrado' });

                const currentExp = neg.fecha_vencimiento ? new Date(neg.fecha_vencimiento).getTime() : Date.now();
                const baseTime = currentExp > Date.now() ? currentExp : Date.now();
                const nuevaFecha = new Date(baseTime + Number(dias) * 86400 * 1000).toISOString();

                await db.run(
                    'UPDATE negocios SET fecha_vencimiento = ?, estado = ?, plan = COALESCE(?, plan) WHERE id = ?',
                    [nuevaFecha, 'ACTIVO', plan || null, negocio_id]
                );

                const updated = await db.get('SELECT * FROM negocios WHERE id = ?', [negocio_id]);
                return res.json({ mensaje: `Suscripción extendida +${dias} días`, negocio: updated });
            }

            if (action === 'toggle_estado') {
                if (!isSuperAdmin) return res.status(403).json({ error: 'No autorizado' });
                const { negocio_id, estado } = body;
                const nuevoEstado = estado === 'SUSPENDIDO' ? 'SUSPENDIDO' : 'ACTIVO';
                await db.run('UPDATE negocios SET estado = ? WHERE id = ?', [nuevoEstado, negocio_id]);
                const updated = await db.get('SELECT * FROM negocios WHERE id = ?', [negocio_id]);
                return res.json({ mensaje: 'Estado actualizado', negocio: updated });
            }

            if (action === 'regenerate_apikey') {
                const targetId = isSuperAdmin ? body.negocio_id : req.user.negocio_id;
                const newKey = generateTenantApiKey();
                await db.run('UPDATE negocios SET api_key = ? WHERE id = ?', [newKey, targetId]);
                const updated = await db.get('SELECT * FROM negocios WHERE id = ?', [targetId]);
                return res.json({ mensaje: 'Nueva API Key generada', api_key: newKey, negocio: updated });
            }

            if (action === 'update_settings') {
                const targetId = isSuperAdmin ? (body.negocio_id || req.user.negocio_id) : req.user.negocio_id;
                const neg = await db.get('SELECT * FROM negocios WHERE id = ?', [targetId]);
                if (!neg) return res.status(404).json({ error: 'Negocio no encontrado' });

                const webhook = body.webhook_url !== undefined ? body.webhook_url.trim() : neg.webhook_url;
                const whatsapp = body.whatsapp_alerta !== undefined ? body.whatsapp_alerta.trim() : neg.whatsapp_alerta;
                const nombre = isSuperAdmin && body.nombre_comercial !== undefined ? body.nombre_comercial.trim() : neg.nombre_comercial;
                const ruc = isSuperAdmin && body.ruc_o_telefono !== undefined ? body.ruc_o_telefono.trim() : neg.ruc_o_telefono;
                const precio = isSuperAdmin && body.precio_plan !== undefined ? parseFloat(body.precio_plan) || 0 : neg.precio_plan;
                const notas = isSuperAdmin && body.notas_admin !== undefined ? body.notas_admin : neg.notas_admin;

                await db.run(
                    `UPDATE negocios SET webhook_url = ?, whatsapp_alerta = ?, nombre_comercial = ?, ruc_o_telefono = ?, precio_plan = ?, notas_admin = ? WHERE id = ?`,
                    [webhook, whatsapp, nombre, ruc, precio, notas, targetId]
                );

                const updated = await db.get('SELECT * FROM negocios WHERE id = ?', [targetId]);
                return res.json({ mensaje: 'Configuración guardada', negocio: updated });
            }

            if (action === 'update_usuario') {
                const { usuario_id, password, activo, nombre_mostrar } = body;
                const targetUser = await db.get('SELECT * FROM usuarios_negocio WHERE id = ?', [usuario_id]);
                if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });
                if (!isSuperAdmin && targetUser.negocio_id !== req.user.negocio_id) {
                    return res.status(403).json({ error: 'No autorizado' });
                }

                await db.run(
                    `UPDATE usuarios_negocio SET password = ?, activo = ?, nombre_mostrar = ? WHERE id = ?`,
                    [
                        password || targetUser.password,
                        activo !== undefined ? (activo ? 1 : 0) : targetUser.activo,
                        nombre_mostrar ? nombre_mostrar.trim() : targetUser.nombre_mostrar,
                        usuario_id
                    ]
                );
                const updated = await db.get('SELECT * FROM usuarios_negocio WHERE id = ?', [usuario_id]);
                return res.json({ mensaje: 'Usuario actualizado', usuario: { ...updated, activo: Boolean(updated.activo) } });
            }
        }

        if (req.method === 'DELETE') {
            const { type = 'negocio', id } = req.query || {};
            if (!id) return res.status(400).json({ error: 'ID requerido' });

            if (type === 'negocio') {
                if (!isSuperAdmin) return res.status(403).json({ error: 'Solo SuperAdmin puede eliminar negocios' });
                await db.run('DELETE FROM pagos WHERE negocio_id = ?', [id]);
                await db.run('DELETE FROM usuarios_negocio WHERE negocio_id = ?', [id]);
                await db.run('DELETE FROM negocios WHERE id = ?', [id]);
                return res.json({ mensaje: 'Negocio eliminado con éxito' });
            }

            if (type === 'usuario') {
                const targetUser = await db.get('SELECT * FROM usuarios_negocio WHERE id = ?', [id]);
                if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });
                if (!isSuperAdmin && targetUser.negocio_id !== req.user.negocio_id) {
                    return res.status(403).json({ error: 'No autorizado' });
                }
                if (!isSuperAdmin && targetUser.rol === 'DUENO') {
                    return res.status(403).json({ error: 'No puedes eliminar la cuenta del dueño' });
                }
                await db.run('DELETE FROM usuarios_negocio WHERE id = ?', [id]);
                return res.json({ mensaje: 'Usuario eliminado' });
            }
        }

        return res.status(405).json({ error: 'Método o acción no soportada' });
    } catch (error) {
        console.error('Error en /api/admin:', error);
        return res.status(500).json({ error: 'Error interno en /api/admin' });
    }
});

// ==========================================
// 3. RECEPCIÓN Y GESTIÓN DE PAGOS (/api/pagos)
// ==========================================
app.post('/api/pagos', async (req, res) => {
    const apiKey = (req.headers['x-api-key'] || '').trim();
    if (!apiKey) {
        return res.status(401).json({ error: 'API Key ausente en cabecera X-API-Key' });
    }

    const { remitente, monto, timestamp, codigo_seguridad, banco } = req.body || {};
    if (!remitente || monto === undefined || !timestamp) {
        return res.status(400).json({ error: 'Campos faltantes en el payload' });
    }

    try {
        const db = await getDatabaseConnection();
        let targetNegocio = await db.get('SELECT * FROM negocios WHERE api_key = ?', [apiKey]);

        if (targetNegocio) {
            const sub = checkBusinessSubscription(targetNegocio);
            if (!sub.valid) {
                return res.status(402).json({ error: sub.reason, subscription_expired: true });
            }
        } else if (apiKey !== YAPE_API_KEY) {
            return res.status(401).json({ error: 'API Key inválida o negocio no registrado' });
        }

        const bankName = (banco || 'YAPE').toUpperCase();
        const negId = targetNegocio ? targetNegocio.id : null;

        const result = await db.run(
            `INSERT INTO pagos (negocio_id, remitente, monto, timestamp, codigo_seguridad, banco, validado)
             VALUES (?, ?, ?, ?, ?, ?, 0)`,
            [
                negId,
                String(remitente).trim(),
                parseFloat(monto),
                parseInt(timestamp),
                codigo_seguridad ? String(codigo_seguridad).trim() : '',
                bankName
            ]
        );

        const newPayment = await db.get('SELECT * FROM pagos WHERE id = ?', [result.lastID]);
        emitToTenantAndSuperAdmin('nuevo_pago', newPayment, negId);

        if (targetNegocio && targetNegocio.webhook_url) {
            dispatchWebhookIfConfigured(targetNegocio, newPayment);
        }

        return res.status(201).json({ message: 'Pago registrado con éxito', pago: newPayment });
    } catch (error) {
        console.error('Error al registrar pago:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/api/pagos', verifyJwtToken, async (req, res) => {
    const { fecha_inicio, fecha_fin, validado, search, banco, negocio_id: filterNegId } = req.query;
    const isSuperAdmin = req.user.rol === 'SUPERADMIN';
    const isCajero = req.user.rol === 'CAJERO';

    try {
        const db = await getDatabaseConnection();
        let query = 'SELECT * FROM pagos WHERE 1=1';
        const params = [];

        if (!isSuperAdmin) {
            query += ' AND negocio_id = ?';
            params.push(req.user.negocio_id);
        } else if (filterNegId === 'MASTER') {
            query += ' AND negocio_id IS NULL';
        } else if (filterNegId) {
            query += ' AND negocio_id = ?';
            params.push(filterNegId);
        }

        if (isCajero) {
            const hace24h = Math.floor(Date.now() / 1000) - 86400;
            query += ' AND timestamp >= ?';
            params.push(hace24h);
        } else {
            if (fecha_inicio) {
                const startEpoch = Math.floor(new Date(`${fecha_inicio}T00:00:00`).getTime() / 1000);
                if (!isNaN(startEpoch)) {
                    query += ' AND timestamp >= ?';
                    params.push(startEpoch);
                }
            }
            if (fecha_fin) {
                const endEpoch = Math.floor(new Date(`${fecha_fin}T23:59:59`).getTime() / 1000);
                if (!isNaN(endEpoch)) {
                    query += ' AND timestamp <= ?';
                    params.push(endEpoch);
                }
            }
        }

        if (validado !== undefined && validado !== '') {
            query += ' AND validado = ?';
            params.push(parseInt(validado) === 1 ? 1 : 0);
        }

        if (banco) {
            query += ' AND UPPER(banco) = UPPER(?)';
            params.push(banco);
        }

        if (search) {
            query += ' AND (remitente LIKE ? OR CAST(monto AS TEXT) LIKE ? OR codigo_seguridad LIKE ?)';
            const term = `%${search}%`;
            params.push(term, term, term);
        }

        query += ' ORDER BY timestamp DESC';
        const pagos = await db.all(query, params);
        return res.json(pagos);
    } catch (error) {
        console.error('Error al consultar pagos:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

async function handleValidarPago(req, res) {
    const id = req.params.id || req.query.id || req.body?.id;
    const notaPedido = req.body?.nota_pedido;
    const userWhoValidated = req.user.nombre || req.user.username;

    if (!id) return res.status(400).json({ error: 'ID de pago requerido' });

    try {
        const db = await getDatabaseConnection();
        const payment = await db.get('SELECT * FROM pagos WHERE id = ?', [id]);
        if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });

        if (req.user.rol !== 'SUPERADMIN' && payment.negocio_id !== req.user.negocio_id) {
            return res.status(403).json({ error: 'No tienes acceso a este pago' });
        }

        const fechaValidacion = new Date().toISOString();
        await db.run(
            `UPDATE pagos SET validado = 1, fecha_validacion = ?, usuario_validador = ?, nota_pedido = COALESCE(?, nota_pedido) WHERE id = ?`,
            [fechaValidacion, userWhoValidated, notaPedido !== undefined ? String(notaPedido).trim() : null, id]
        );

        const updatedPayment = await db.get('SELECT * FROM pagos WHERE id = ?', [id]);
        emitToTenantAndSuperAdmin('pago_validado', updatedPayment, updatedPayment.negocio_id);
        return res.json({ message: 'Pago validado con éxito', pago: updatedPayment });
    } catch (error) {
        console.error('Error al validar pago:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}

app.patch('/api/pagos', verifyJwtToken, handleValidarPago);
app.patch('/api/pagos/:id/validar', verifyJwtToken, handleValidarPago);

async function handleDeleteSingle(req, res) {
    if (req.user.rol === 'CAJERO') {
        return res.status(403).json({ error: 'El perfil de Cajero no puede eliminar registros de pagos.' });
    }
    const id = req.params.id || req.query.id;
    try {
        const db = await getDatabaseConnection();
        const payment = await db.get('SELECT * FROM pagos WHERE id = ?', [id]);
        if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });

        if (req.user.rol !== 'SUPERADMIN' && payment.negocio_id !== req.user.negocio_id) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        await db.run('DELETE FROM pagos WHERE id = ?', [id]);
        emitToTenantAndSuperAdmin('pago_eliminado', { id: Number(id) }, payment.negocio_id);
        return res.json({ message: 'Pago eliminado con éxito' });
    } catch (error) {
        console.error('Error al eliminar pago:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}

app.delete('/api/pagos/:id', verifyJwtToken, handleDeleteSingle);

app.delete('/api/pagos', verifyJwtToken, async (req, res) => {
    if (req.user.rol === 'CAJERO') {
        return res.status(403).json({ error: 'El perfil de Cajero no puede eliminar registros de pagos.' });
    }

    if (req.query.id) {
        return handleDeleteSingle(req, res);
    }

    try {
        const db = await getDatabaseConnection();
        if (req.user.rol !== 'SUPERADMIN') {
            await db.run('DELETE FROM pagos WHERE negocio_id = ?', [req.user.negocio_id]);
            emitToTenantAndSuperAdmin('pagos_limpiados', { negocio_id: req.user.negocio_id }, req.user.negocio_id);
            return res.json({ message: 'Historial de tu negocio limpiado con éxito' });
        }

        const targetNegId = req.query.negocio_id;
        if (targetNegId && targetNegId !== 'ALL') {
            if (targetNegId === 'MASTER') {
                await db.run('DELETE FROM pagos WHERE negocio_id IS NULL');
            } else {
                await db.run('DELETE FROM pagos WHERE negocio_id = ?', [targetNegId]);
                emitToTenantAndSuperAdmin('pagos_limpiados', { negocio_id: targetNegId }, targetNegId);
            }
            return res.json({ message: 'Historial filtrado eliminado con éxito' });
        }

        await db.run('DELETE FROM pagos');
        io.emit('pagos_limpiados', {});
        return res.json({ message: 'Historial de pagos eliminado con éxito' });
    } catch (error) {
        console.error('Error al limpiar pagos:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// WebSocket Connection con aislamiento por empresa (Salas / Rooms)
io.on('connection', (socket) => {
    const token = socket.handshake.auth?.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.rol === 'SUPERADMIN') {
                socket.join('role:SUPERADMIN');
            } else if (decoded.negocio_id) {
                socket.join(`tenant:${decoded.negocio_id}`);
            }
        } catch (err) {
            // Token expirado o inválido
        }
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
    getDatabaseConnection()
        .then(() => {
            server.listen(PORT, () => {
                console.log(`Servidor SaaS Multi-Empresa ejecutándose en el puerto ${PORT}`);
            });
        })
        .catch((err) => {
            console.error('Error crítico al inicializar la base de datos:', err);
            process.exit(1);
        });
}

module.exports = { app, server };
