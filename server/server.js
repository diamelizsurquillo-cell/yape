require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getDatabaseConnection } = require('./database');

const app = express();
const server = http.createServer(app);

// Configuración de WebSockets (Socket.io)
const io = new Server(server, {
    cors: {
        origin: '*', // Permitir conexiones desde cualquier origen en desarrollo
        methods: ['GET', 'POST']
    }
});

// Middleware generales
app.use(cors());
app.use(express.json());

// Log de peticiones entrantes para diagnóstico
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    console.log(`Headers: ${JSON.stringify(req.headers)}`);
    console.log(`Body: ${JSON.stringify(req.body)}`);
    next();
});

// Servir frontend compilado en producción (carpeta public)
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de variables de entorno con valores por defecto
const PORT = process.env.PORT || 3000;
const YAPE_API_KEY = process.env.YAPE_API_KEY || 'mi_yape_secreto_123';
const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'yape1234';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto_token_yape_987';

// Middleware para verificar la API Key (usado por la app Android)
function verifyApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== YAPE_API_KEY) {
        return res.status(401).json({ error: 'API Key inválida o ausente' });
    }
    next();
}

// Middleware para verificar el Token JWT (usado por el Dashboard Web)
function verifyJwtToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato: Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Acceso denegado: Token ausente' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Token inválido o expirado' });
    }
}

// ==========================================
// RUTAS DE LA API
// ==========================================

// Endpoint POST /api/pagos (recibe el pago desde la app Android)
app.post('/api/pagos', verifyApiKey, async (req, res) => {
    const { remitente, monto, timestamp, codigo_seguridad } = req.body;

    if (!remitente || monto === undefined || !timestamp) {
        return res.status(400).json({ error: 'Campos faltantes en el payload' });
    }

    try {
        const db = await getDatabaseConnection();
        
        // Obtener información de las columnas de la tabla 'pagos'
        const columns = await db.all('PRAGMA table_info(pagos);');
        const hasCodigoSeguridad = columns.some(col => col.name === 'codigo_seguridad');
        const hasDispositivoId = columns.some(col => col.name === 'dispositivo_id');

        let query = '';
        let params = [];

        if (hasCodigoSeguridad && hasDispositivoId) {
            query = `INSERT INTO pagos (remitente, monto, timestamp, codigo_seguridad, dispositivo_id, validado) 
                     VALUES (?, ?, ?, ?, ?, 0)`;
            params = [
                remitente.trim(), 
                parseFloat(monto), 
                parseInt(timestamp), 
                codigo_seguridad ? codigo_seguridad.trim() : '',
                codigo_seguridad ? codigo_seguridad.trim() : ''
            ];
        } else if (hasCodigoSeguridad) {
            query = `INSERT INTO pagos (remitente, monto, timestamp, codigo_seguridad, validado) 
                     VALUES (?, ?, ?, ?, 0)`;
            params = [
                remitente.trim(), 
                parseFloat(monto), 
                parseInt(timestamp), 
                codigo_seguridad ? codigo_seguridad.trim() : ''
            ];
        } else {
            // Base de datos vieja
            query = `INSERT INTO pagos (remitente, monto, timestamp, dispositivo_id, validado) 
                     VALUES (?, ?, ?, ?, 0)`;
            params = [
                remitente.trim(), 
                parseFloat(monto), 
                parseInt(timestamp), 
                codigo_seguridad ? codigo_seguridad.trim() : ''
            ];
        }

        const result = await db.run(query, params);

        const newPaymentId = result.lastID;
        const newPayment = await db.get('SELECT * FROM pagos WHERE id = ?', [newPaymentId]);

        const pagoAdaptado = {
            ...newPayment,
            codigo_seguridad: newPayment.codigo_seguridad !== undefined ? newPayment.codigo_seguridad : newPayment.dispositivo_id
        };

        // Emitir notificación por WebSocket en tiempo real
        io.emit('nuevo_pago', pagoAdaptado);
        console.log('Nuevo pago registrado y transmitido:', pagoAdaptado);

        return res.status(201).json({ message: 'Pago registrado con éxito', pago: pagoAdaptado });
    } catch (error) {
        console.error('Error al registrar pago:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint POST /api/auth/login (autenticación del dashboard)
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    if (username === DASHBOARD_USERNAME && password === DASHBOARD_PASSWORD) {
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
        return res.json({ success: true, token });
    }

    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
});

// Endpoint GET /api/pagos (consulta de pagos filtrada para el dashboard)
app.get('/api/pagos', verifyJwtToken, async (req, res) => {
    const { fecha_inicio, fecha_fin, validado, search } = req.query;

    try {
        const db = await getDatabaseConnection();
        let query = 'SELECT * FROM pagos WHERE 1=1';
        const params = [];

        // Filtro por fecha inicio (YYYY-MM-DD)
        if (fecha_inicio) {
            const startEpoch = Math.floor(new Date(`${fecha_inicio}T00:00:00`).getTime() / 1000);
            if (!isNaN(startEpoch)) {
                query += ' AND timestamp >= ?';
                params.push(startEpoch);
            }
        }

        // Filtro por fecha fin (YYYY-MM-DD)
        if (fecha_fin) {
            const endEpoch = Math.floor(new Date(`${fecha_fin}T23:59:59`).getTime() / 1000);
            if (!isNaN(endEpoch)) {
                query += ' AND timestamp <= ?';
                params.push(endEpoch);
            }
        }

        // Filtro por validado (0 = pendiente, 1 = validado)
        if (validado !== undefined && validado !== '') {
            query += ' AND validado = ?';
            params.push(parseInt(validado) === 1 ? 1 : 0);
        }

        // Búsqueda textual (remitente o monto)
        if (search) {
            query += ' AND (remitente LIKE ? OR monto LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm);
        }

        // Ordenar por fecha más reciente arriba
        query += ' ORDER BY timestamp DESC';

        const pagos = await db.all(query, params);
        
        // Mapear pagos para retrocompatibilidad con esquemas viejos
        const pagosAdaptados = pagos.map(pago => ({
            ...pago,
            codigo_seguridad: pago.codigo_seguridad !== undefined ? pago.codigo_seguridad : pago.dispositivo_id
        }));

        return res.json(pagosAdaptados);
    } catch (error) {
        console.error('Error al consultar pagos:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint PATCH /api/pagos/:id/validar (marca un pago como validado)
app.patch('/api/pagos/:id/validar', verifyJwtToken, async (req, res) => {
    const { id } = req.params;
    const userWhoValidated = req.user.username;

    try {
        const db = await getDatabaseConnection();

        // Verificar si existe el pago
        const payment = await db.get('SELECT * FROM pagos WHERE id = ?', [id]);
        if (!payment) {
            return res.status(404).json({ error: 'Pago no encontrado' });
        }

        // Actualizar estado de validación
        const fechaValidacion = new Date().toISOString();
        await db.run(
            `UPDATE pagos 
             SET validado = 1, fecha_validacion = ?, usuario_validador = ? 
             WHERE id = ?`,
            [fechaValidacion, userWhoValidated, id]
        );

        const updatedPayment = await db.get('SELECT * FROM pagos WHERE id = ?', [id]);
        
        const pagoAdaptado = {
            ...updatedPayment,
            codigo_seguridad: updatedPayment.codigo_seguridad !== undefined ? updatedPayment.codigo_seguridad : updatedPayment.dispositivo_id
        };

        // Emitir cambio por WebSocket
        io.emit('pago_validado', pagoAdaptado);
        console.log(`Pago ID ${id} validado por ${userWhoValidated}`);

        return res.json({ message: 'Pago validado con éxito', pago: pagoAdaptado });
    } catch (error) {
        console.error('Error al validar pago:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint DELETE /api/pagos (limpia todo el historial de pagos de la base de datos)
app.delete('/api/pagos', verifyJwtToken, async (req, res) => {
    try {
        const db = await getDatabaseConnection();
        await db.run('DELETE FROM pagos');
        io.emit('pagos_limpiados');
        console.log(`Historial de pagos limpiado por ${req.user.username}`);
        return res.json({ message: 'Historial de pagos eliminado con éxito' });
    } catch (error) {
        console.error('Error al limpiar pagos:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// WebSocket Connection logging
io.on('connection', (socket) => {
    console.log('Cliente conectado vía WebSocket:', socket.id);
    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});

// Fallback para SPA React (cualquier ruta no API sirve el index.html)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Arrancar servidor
getDatabaseConnection()
    .then(() => {
        server.listen(PORT, () => {
            console.log(`Servidor ejecutándose en el puerto ${PORT}`);
        });
    })
    .catch((err) => {
        console.error('Error crítico al inicializar la base de datos:', err);
        process.exit(1);
    });
