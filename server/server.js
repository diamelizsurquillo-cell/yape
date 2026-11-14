require('dotenv').config();
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const net = require('net');
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

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '64kb' }));

// Cabeceras HTTP de Seguridad (OWASP)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const YAPE_API_KEY = process.env.YAPE_API_KEY || 'mi_yape_secreto_123';
const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'yape1234';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto_token_yape_987_local_fallback';

const rateLimitBuckets = new Map();

function checkRateLimit(key, maxReqs = 10, windowMs = 60000) {
    const now = Date.now();
    const entry = rateLimitBuckets.get(key);
    if (!entry || now > entry.resetAt) {
        rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfterSec: 0 };
    }
    entry.count += 1;
    if (entry.count > maxReqs) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }
    return { allowed: true, retryAfterSec: 0 };
}

function getDerivedAesKey() {
    return crypto.scryptSync(JWT_SECRET, 'yape-saas-pwd-salt-v1', 32);
}

function encryptSecret(plainText) {
    const text = String(plainText || '');
    if (!text || text.startsWith('enc:v1:')) return text;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getDerivedAesKey(), iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(storedValue) {
    const val = String(storedValue || '');
    if (!val.startsWith('enc:v1:')) return val;
    try {
        const parts = val.split(':');
        if (parts.length !== 5) return '';
        const iv = Buffer.from(parts[2], 'hex');
        const authTag = Buffer.from(parts[3], 'hex');
        const encrypted = Buffer.from(parts[4], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', getDerivedAesKey(), iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
        return '';
    }
}

function safeEqualStrings(a, b) {
    const bufA = Buffer.from(String(a || ''), 'utf8');
    const bufB = Buffer.from(String(b || ''), 'utf8');
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

function verifyPasswordTimingSafe(storedValue, candidatePlain) {
    const realPlain = decryptSecret(storedValue);
    if (!realPlain) return false;
    return safeEqualStrings(realPlain, String(candidatePlain || ''));
}

function sanitizeText(str, maxLength = 100) {
    return String(str || '')
        .replace(/[\u0000-\u001F\u007F<>]/g, '')
        .trim()
        .slice(0, maxLength);
}

function isPrivateOrReservedIp(ip) {
    if (net.isIPv4(ip)) {
        const p = ip.split('.').map(Number);
        if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
        if (p[0] === 169 && p[1] === 254) return true;
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
        if (p[0] === 192 && p[1] === 168) return true;
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
        if (p[0] >= 224) return true;
        return false;
    }
    if (net.isIPv6(ip)) {
        const norm = ip.toLowerCase();
        if (norm === '::1' || norm === '::' || norm.startsWith('fc') || norm.startsWith('fd') || norm.startsWith('fe80')) {
            return true;
        }
    }
    return false;
}

function validateSafeWebhookUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return { valid: true, url: '' };
    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { valid: false, error: 'URL de Webhook inválida' };
    }
    if (parsed.protocol !== 'https:') {
        return { valid: false, error: 'Por seguridad, el Webhook debe usar protocolo https://' };
    }
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local') ||
        host.endsWith('.internal') ||
        host === 'metadata.google.internal' ||
        isPrivateOrReservedIp(host)
    ) {
        return { valid: false, error: 'URL de Webhook rechazada por política Anti-SSRF (hosts internos prohibidos).' };
    }
    return { valid: true, url: parsed.toString() };
}

function generateTenantApiKey() {
    return `yp_live_${crypto.randomBytes(16).toString('hex')}`;
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
    const whCheck = validateSafeWebhookUrl(negocio?.webhook_url);
    if (!whCheck.valid || !whCheck.url) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
        await fetch(whCheck.url, {
            method: 'POST',
            redirect: 'error',
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
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
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
    } catch {
        return res.status(403).json({ error: 'Token inválido o expirado' });
    }
}

function emitToTenantAndSuperAdmin(eventName, payload, negocioId) {
    io.to('role:SUPERADMIN').emit(eventName, payload);
    if (negocioId) {
        io.to(`tenant:${negocioId}`).emit(eventName, payload);
    }
}

function mapUserForAdmin(u) {
    return {
        ...u,
        activo: Boolean(u.activo),
        password: decryptSecret(u.password)
    };
}

// ==========================================
// 1. AUTENTICACIÓN MULTI-EMPRESA (/api/auth/login)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
    const ip = req.ip || 'local';
    const rl = checkRateLimit(`login:${ip}`, 12, 5 * 60 * 1000);
    if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSec));
        return res.status(429).json({ error: `Demasiados intentos. Espera ${rl.retryAfterSec}s.` });
    }

    const rawUser = String(req.body?.username || '').trim().slice(0, 64);
    const rawPass = String(req.body?.password || '').slice(0, 128);

    if (!rawUser || !rawPass) {
        return res.status(400).json({ error: 'Ingresa tu usuario y contraseña' });
    }

    if (
        safeEqualStrings(rawUser.toLowerCase(), DASHBOARD_USERNAME.toLowerCase()) &&
        safeEqualStrings(rawPass, DASHBOARD_PASSWORD)
    ) {
        const jwtClaims = {
            id: 'superadmin',
            username: DASHBOARD_USERNAME,
            nombre: 'Super Administrador',
            rol: 'SUPERADMIN',
            negocio_id: null,
            nombre_comercial: 'Administración Central SaaS',
            plan: 'ILIMITADO'
        };
        const token = jwt.sign(jwtClaims, JWT_SECRET, { algorithm: 'HS256', expiresIn: '3d' });
        return res.json({ success: true, token, user: jwtClaims });
    }

    try {
        const db = await getDatabaseConnection();
        const usuario = await db.get(
            'SELECT * FROM usuarios_negocio WHERE LOWER(username) = LOWER(?)',
            [rawUser]
        );

        if (!usuario || !verifyPasswordTimingSafe(usuario.password, rawPass)) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }

        if (usuario.password && !String(usuario.password).startsWith('enc:v1:')) {
            await db.run('UPDATE usuarios_negocio SET password = ? WHERE id = ?', [
                encryptSecret(rawPass),
                usuario.id
            ]);
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
        // Sin api_key en el JWT
        const jwtClaims = {
            id: usuario.id,
            username: usuario.username,
            nombre: usuario.nombre_mostrar || usuario.username,
            rol,
            negocio_id: negocio.id,
            nombre_comercial: negocio.nombre_comercial,
            plan: negocio.plan || 'MENSUAL',
            fecha_vencimiento: negocio.fecha_vencimiento,
            ...(rol === 'DUENO' ? { whatsapp_alerta: negocio.whatsapp_alerta || '' } : {})
        };

        const token = jwt.sign(jwtClaims, JWT_SECRET, { algorithm: 'HS256', expiresIn: '3d' });
        return res.json({ success: true, token, user: jwtClaims });
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
                    usuarios: usuarios.filter((u) => u.negocio_id === n.id).map(mapUserForAdmin),
                    total_pagos: statsMap[n.id]?.total_pagos || 0,
                    volumen_soles: statsMap[n.id]?.volumen_soles || 0
                }));

                return res.json({ schemaReady: true, usingServiceRole: true, negocios: enriched });
            }

            const miNegocio = await db.get('SELECT * FROM negocios WHERE id = ?', [req.user.negocio_id]);
            const misUsuarios = await db.all(
                'SELECT id, username, password, nombre_mostrar, rol, activo, created_at FROM usuarios_negocio WHERE negocio_id = ? ORDER BY created_at ASC',
                [req.user.negocio_id]
            );
            return res.json({
                schemaReady: true,
                negocio: miNegocio,
                usuarios: misUsuarios.map(mapUserForAdmin)
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

                const cleanNombre = sanitizeText(nombre_comercial, 100);
                const cleanDueno = sanitizeText(dueno_username, 50);
                if (!cleanNombre || !cleanDueno || !dueno_password) {
                    return res.status(400).json({ error: 'Nombre comercial, usuario y clave del dueño son obligatorios' });
                }

                const whCheck = validateSafeWebhookUrl(webhook_url);
                if (!whCheck.valid) return res.status(400).json({ error: whCheck.error });

                const dupDueno = await db.get('SELECT id FROM usuarios_negocio WHERE LOWER(username) = LOWER(?)', [cleanDueno]);
                if (dupDueno) {
                    return res.status(409).json({ error: `El usuario "${cleanDueno}" ya está registrado.` });
                }
                const cleanCajero = sanitizeText(cajero_username, 50);
                if (cleanCajero) {
                    const dupCaj = await db.get('SELECT id FROM usuarios_negocio WHERE LOWER(username) = LOWER(?)', [cleanCajero]);
                    if (dupCaj) {
                        return res.status(409).json({ error: `El usuario "${cleanCajero}" ya está registrado.` });
                    }
                }

                const negocioId = crypto.randomUUID();
                const apiKey = generateTenantApiKey();
                const dias = Math.min(3650, Math.max(1, parseInt(dias_vigencia, 10) || 30));
                const fechaVenc = new Date(Date.now() + dias * 86400 * 1000).toISOString();

                await db.run(
                    `INSERT INTO negocios (id, nombre_comercial, ruc_o_telefono, api_key, plan, precio_plan, estado, fecha_vencimiento, webhook_url, whatsapp_alerta, notas_admin)
                     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVO', ?, ?, ?, ?)`,
                    [
                        negocioId,
                        cleanNombre,
                        sanitizeText(ruc_o_telefono, 30),
                        apiKey,
                        ['TRIAL', 'MENSUAL', 'ANUAL'].includes(plan) ? plan : 'MENSUAL',
                        Math.max(0, parseFloat(precio_plan) || 0),
                        fechaVenc,
                        whCheck.url,
                        sanitizeText(whatsapp_alerta, 25),
                        sanitizeText(notas_admin, 250)
                    ]
                );

                const duenoId = crypto.randomUUID();
                await db.run(
                    `INSERT INTO usuarios_negocio (id, negocio_id, username, password, nombre_mostrar, rol, activo)
                     VALUES (?, ?, ?, ?, ?, 'DUENO', 1)`,
                    [duenoId, negocioId, cleanDueno, encryptSecret(dueno_password), `Dueño - ${cleanNombre}`]
                );

                if (cleanCajero && cajero_password) {
                    const cajId = crypto.randomUUID();
                    await db.run(
                        `INSERT INTO usuarios_negocio (id, negocio_id, username, password, nombre_mostrar, rol, activo)
                         VALUES (?, ?, ?, ?, ?, 'CAJERO', 1)`,
                        [cajId, negocioId, cleanCajero, encryptSecret(cajero_password), `Caja - ${cleanNombre}`]
                    );
                }

                const nuevoNegocio = await db.get('SELECT * FROM negocios WHERE id = ?', [negocioId]);
                const usuarios = await db.all('SELECT * FROM usuarios_negocio WHERE negocio_id = ?', [negocioId]);

                return res.status(201).json({
                    mensaje: 'Cliente registrado exitosamente',
                    negocio: {
                        ...nuevoNegocio,
                        usuarios: usuarios.map(mapUserForAdmin),
                        total_pagos: 0,
                        volumen_soles: 0
                    }
                });
            }

            if (action === 'create_usuario') {
                const targetNegId = isSuperAdmin ? body.negocio_id : req.user.negocio_id;
                const rolSolicitado = isSuperAdmin && body.rol === 'DUENO' ? 'DUENO' : 'CAJERO';
                const cleanUser = sanitizeText(body.username, 50);
                const rawPassword = String(body.password || '');

                if (!targetNegId || !cleanUser || !rawPassword) {
                    return res.status(400).json({ error: 'Faltan datos obligatorios del usuario' });
                }

                const existe = await db.get('SELECT id FROM usuarios_negocio WHERE LOWER(username) = LOWER(?)', [cleanUser]);
                if (existe) return res.status(409).json({ error: 'Ese nombre de usuario ya está ocupado' });

                const uid = crypto.randomUUID();
                await db.run(
                    `INSERT INTO usuarios_negocio (id, negocio_id, username, password, nombre_mostrar, rol, activo)
                     VALUES (?, ?, ?, ?, ?, ?, 1)`,
                    [uid, targetNegId, cleanUser, encryptSecret(rawPassword), sanitizeText(body.nombre_mostrar || cleanUser, 80), rolSolicitado]
                );

                const creado = await db.get('SELECT * FROM usuarios_negocio WHERE id = ?', [uid]);
                return res.status(201).json({
                    mensaje: 'Usuario creado con éxito',
                    usuario: mapUserForAdmin(creado)
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

                const safeDias = Math.min(3650, Math.max(1, Number(dias) || 30));
                const currentExp = neg.fecha_vencimiento ? new Date(neg.fecha_vencimiento).getTime() : Date.now();
                const baseTime = currentExp > Date.now() ? currentExp : Date.now();
                const nuevaFecha = new Date(baseTime + safeDias * 86400 * 1000).toISOString();

                await db.run(
                    'UPDATE negocios SET fecha_vencimiento = ?, estado = ?, plan = COALESCE(?, plan) WHERE id = ?',
                    [nuevaFecha, 'ACTIVO', plan || null, negocio_id]
                );

                const updated = await db.get('SELECT * FROM negocios WHERE id = ?', [negocio_id]);
                return res.json({ mensaje: `Suscripción extendida +${safeDias} días`, negocio: updated });
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

                let webhook = neg.webhook_url;
                if (body.webhook_url !== undefined) {
                    const whCheck = validateSafeWebhookUrl(body.webhook_url);
                    if (!whCheck.valid) return res.status(400).json({ error: whCheck.error });
                    webhook = whCheck.url;
                }

                const whatsapp = body.whatsapp_alerta !== undefined ? sanitizeText(body.whatsapp_alerta, 25) : neg.whatsapp_alerta;
                const nombre = isSuperAdmin && body.nombre_comercial ? sanitizeText(body.nombre_comercial, 100) : neg.nombre_comercial;
                const ruc = isSuperAdmin && body.ruc_o_telefono !== undefined ? sanitizeText(body.ruc_o_telefono, 30) : neg.ruc_o_telefono;
                const plan = isSuperAdmin && body.plan ? body.plan : neg.plan;
                const estado = isSuperAdmin && body.estado ? body.estado : neg.estado;
                const fechaVenc = isSuperAdmin && body.fecha_vencimiento ? body.fecha_vencimiento : neg.fecha_vencimiento;
                const precio = isSuperAdmin && body.precio_plan !== undefined ? Math.max(0, parseFloat(body.precio_plan) || 0) : neg.precio_plan;
                const notas = isSuperAdmin && body.notas_admin !== undefined ? sanitizeText(body.notas_admin, 250) : neg.notas_admin;

                await db.run(
                    `UPDATE negocios SET webhook_url = ?, whatsapp_alerta = ?, nombre_comercial = ?, ruc_o_telefono = ?, plan = ?, estado = ?, fecha_vencimiento = ?, precio_plan = ?, notas_admin = ? WHERE id = ?`,
                    [webhook, whatsapp, nombre, ruc, plan, estado, fechaVenc, precio, notas, targetId]
                );

                const updated = await db.get('SELECT * FROM negocios WHERE id = ?', [targetId]);
                return res.json({ mensaje: 'Datos del cliente actualizados', negocio: updated });
            }

            if (action === 'update_usuario') {
                const { usuario_id, username, password, rol, activo, nombre_mostrar } = body;
                const targetUser = await db.get('SELECT * FROM usuarios_negocio WHERE id = ?', [usuario_id]);
                if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });
                if (!isSuperAdmin && targetUser.negocio_id !== req.user.negocio_id) {
                    return res.status(403).json({ error: 'No autorizado' });
                }

                let finalUsername = targetUser.username;
                const cleanUser = username ? sanitizeText(username, 50) : '';
                if (cleanUser && cleanUser.toLowerCase() !== targetUser.username.toLowerCase()) {
                    const dup = await db.get(
                        'SELECT id FROM usuarios_negocio WHERE LOWER(username) = LOWER(?) AND id != ?',
                        [cleanUser, usuario_id]
                    );
                    if (dup) {
                        return res.status(409).json({ error: `El nombre de usuario "${cleanUser}" ya está ocupado.` });
                    }
                    finalUsername = cleanUser;
                }

                await db.run(
                    `UPDATE usuarios_negocio SET username = ?, password = ?, rol = ?, activo = ?, nombre_mostrar = ? WHERE id = ?`,
                    [
                        finalUsername,
                        password !== undefined && password !== '' ? encryptSecret(password) : targetUser.password,
                        isSuperAdmin && rol ? rol.toUpperCase() : targetUser.rol,
                        activo !== undefined ? (activo ? 1 : 0) : targetUser.activo,
                        nombre_mostrar ? sanitizeText(nombre_mostrar, 80) : targetUser.nombre_mostrar,
                        usuario_id
                    ]
                );
                const updated = await db.get('SELECT * FROM usuarios_negocio WHERE id = ?', [usuario_id]);
                return res.json({ mensaje: 'Usuario actualizado', usuario: mapUserForAdmin(updated) });
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
    const ip = req.ip || 'local';
    const rl = checkRateLimit(`pagos-post:${ip}`, 45, 60 * 1000);
    if (!rl.allowed) {
        return res.status(429).json({ error: 'Límite de envíos excedido.' });
    }

    const apiKey = String(req.headers['x-api-key'] || '').trim();
    if (!apiKey) {
        return res.status(401).json({ error: 'API Key ausente en cabecera X-API-Key' });
    }

    const { remitente, monto, timestamp, codigo_seguridad, banco } = req.body || {};
    const cleanRemitente = sanitizeText(remitente, 100);
    const numMonto = Number(monto);
    const rawTs = parseInt(timestamp, 10);

    if (!cleanRemitente || !Number.isFinite(numMonto) || numMonto <= 0 || numMonto > 50000) {
        return res.status(400).json({ error: 'Datos de pago inválidos (verifica monto y remitente).' });
    }

    try {
        const db = await getDatabaseConnection();
        let targetNegocio = await db.get('SELECT * FROM negocios WHERE api_key = ?', [apiKey]);

        if (targetNegocio) {
            const sub = checkBusinessSubscription(targetNegocio);
            if (!sub.valid) {
                return res.status(402).json({ error: sub.reason, subscription_expired: true });
            }
        } else if (!safeEqualStrings(apiKey, YAPE_API_KEY)) {
            return res.status(401).json({ error: 'API Key inválida o negocio no registrado' });
        }

        const nowSec = Math.floor(Date.now() / 1000);
        let safeTimestamp = Number.isFinite(rawTs) && rawTs > 0 ? rawTs : nowSec;
        if (safeTimestamp > 9999999999) safeTimestamp = Math.floor(safeTimestamp / 1000);
        if (safeTimestamp > nowSec + 300) safeTimestamp = nowSec;

        const rawBanco = sanitizeText(banco || 'YAPE', 12).toUpperCase();
        const bankName = ['YAPE', 'PLIN', 'BBVA'].includes(rawBanco) ? rawBanco : 'YAPE';
        const codSeg = sanitizeText(codigo_seguridad, 16);
        const negId = targetNegocio ? targetNegocio.id : null;
        const cleanAmount = Math.round(numMonto * 100) / 100;

        // Deduplicación anti-replay (20 segundos)
        const dup = await db.get(
            `SELECT * FROM pagos
             WHERE COALESCE(negocio_id, '') = COALESCE(?, '')
               AND remitente = ?
               AND monto = ?
               AND COALESCE(codigo_seguridad, '') = ?
               AND timestamp >= ?
             LIMIT 1`,
            [negId, cleanRemitente, cleanAmount, codSeg, safeTimestamp - 20]
        );
        if (dup) {
            return res.status(200).json({ message: 'Pago duplicado ignorado', duplicate_ignored: true, pago: dup });
        }

        const result = await db.run(
            `INSERT INTO pagos (negocio_id, remitente, monto, timestamp, codigo_seguridad, banco, validado)
             VALUES (?, ?, ?, ?, ?, ?, 0)`,
            [negId, cleanRemitente, cleanAmount, safeTimestamp, codSeg, bankName]
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

app.get('/api/pagos', async (req, res, next) => {
    // Soporte para receptor Windows con X-API-Key sin exponer Supabase
    if (req.query?.modo === 'desktop_poll') {
        const apiKey = String(req.headers['x-api-key'] || '').trim();
        if (!apiKey) return res.status(401).json({ error: 'X-API-Key requerida' });
        try {
            const db = await getDatabaseConnection();
            let neg = null;
            if (!safeEqualStrings(apiKey, YAPE_API_KEY)) {
                neg = await db.get('SELECT * FROM negocios WHERE api_key = ?', [apiKey]);
                if (!neg) return res.status(401).json({ error: 'API Key inválida' });
                const sub = checkBusinessSubscription(neg);
                if (!sub.valid) return res.status(403).json({ error: sub.reason });
            }
            const sinceSec = parseInt(req.query.since || '0', 10) || Math.floor(Date.now() / 1000) - 60;
            const rows = neg
                ? await db.all('SELECT * FROM pagos WHERE negocio_id = ? AND timestamp >= ? ORDER BY id ASC LIMIT 20', [neg.id, sinceSec])
                : await db.all('SELECT * FROM pagos WHERE timestamp >= ? ORDER BY id ASC LIMIT 20', [sinceSec]);
            return res.json({ negocio: neg ? neg.nombre_comercial : 'Modo Principal', pagos: rows });
        } catch {
            return res.status(500).json({ error: 'Error interno' });
        }
    }
    return verifyJwtToken(req, res, next);
}, async (req, res) => {
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
            params.push(parseInt(validado, 10) === 1 ? 1 : 0);
        }

        if (banco) {
            query += ' AND UPPER(banco) = UPPER(?)';
            params.push(banco);
        }

        if (search) {
            query += ' AND (remitente LIKE ? OR CAST(monto AS TEXT) LIKE ? OR codigo_seguridad LIKE ?)';
            const term = `%${sanitizeText(search, 60)}%`;
            params.push(term, term, term);
        }

        query += ' ORDER BY timestamp DESC LIMIT 500';
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
    const userWhoValidated = sanitizeText(req.user.nombre || req.user.username, 60);

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
            [fechaValidacion, userWhoValidated, notaPedido !== undefined ? sanitizeText(notaPedido, 120) : null, id]
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

io.on('connection', (socket) => {
    const token = socket.handshake.auth?.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            if (decoded.rol === 'SUPERADMIN') {
                socket.join('role:SUPERADMIN');
            } else if (decoded.negocio_id) {
                socket.join(`tenant:${decoded.negocio_id}`);
            }
        } catch {
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
                console.log(`Servidor SaaS Multi-Empresa Blindado ejecutándose en el puerto ${PORT}`);
            });
        })
        .catch((err) => {
            console.error('Error crítico al inicializar la base de datos:', err);
            process.exit(1);
        });
}

module.exports = { app, server };
