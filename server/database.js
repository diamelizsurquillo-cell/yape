const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

let db = null;

async function getDatabaseConnection() {
    if (db) return db;

    const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'yape_payments.db');

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.exec('PRAGMA foreign_keys = ON;');

    // 1. Tabla de Negocios (Multi-Empresa SaaS)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS negocios (
            id TEXT PRIMARY KEY,
            nombre_comercial TEXT NOT NULL,
            ruc_o_telefono TEXT DEFAULT '',
            api_key TEXT UNIQUE NOT NULL,
            plan TEXT DEFAULT 'MENSUAL',
            precio_plan REAL DEFAULT 29.90,
            estado TEXT DEFAULT 'ACTIVO',
            fecha_vencimiento TEXT NOT NULL,
            webhook_url TEXT DEFAULT '',
            whatsapp_alerta TEXT DEFAULT '',
            notas_admin TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // 2. Tabla de Usuarios por Negocio (Dueños y Cajeros)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS usuarios_negocio (
            id TEXT PRIMARY KEY,
            negocio_id TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nombre_mostrar TEXT NOT NULL,
            rol TEXT DEFAULT 'DUENO',
            activo INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
        );
    `);

    // 3. Tabla de Pagos
    await db.exec(`
        CREATE TABLE IF NOT EXISTS pagos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            negocio_id TEXT,
            remitente TEXT NOT NULL,
            monto REAL NOT NULL,
            timestamp INTEGER NOT NULL,
            codigo_seguridad TEXT,
            banco TEXT DEFAULT 'YAPE',
            validado INTEGER DEFAULT 0,
            fecha_validacion TEXT,
            usuario_validador TEXT,
            nota_pedido TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // Migraciones suaves para bases de datos existentes
    const alterStatements = [
        'ALTER TABLE pagos ADD COLUMN codigo_seguridad TEXT;',
        "ALTER TABLE pagos ADD COLUMN banco TEXT DEFAULT 'YAPE';",
        'ALTER TABLE pagos ADD COLUMN negocio_id TEXT;',
        'ALTER TABLE pagos ADD COLUMN nota_pedido TEXT;'
    ];
    for (const stmt of alterStatements) {
        try {
            await db.exec(stmt);
        } catch (e) {
            // Columna ya existente
        }
    }

    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_pagos_timestamp ON pagos(timestamp);
        CREATE INDEX IF NOT EXISTS idx_pagos_negocio ON pagos(negocio_id);
        CREATE INDEX IF NOT EXISTS idx_negocios_apikey ON negocios(api_key);
    `);

    console.log(`Conexión de base de datos SQLite Multi-Tenant establecida en: ${dbPath}`);
    return db;
}

module.exports = { getDatabaseConnection };
