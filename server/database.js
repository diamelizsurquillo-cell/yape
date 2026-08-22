const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

let db = null;

async function getDatabaseConnection() {
    if (db) return db;

    const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'yape_payments.db');

    // Asegurar la existencia del directorio de datos
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    // Crear la tabla pagos si no existe
    await db.exec(`
        CREATE TABLE IF NOT EXISTS pagos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            remitente TEXT NOT NULL,
            monto REAL NOT NULL,
            timestamp INTEGER NOT NULL,
            codigo_seguridad TEXT,
            banco TEXT DEFAULT 'YAPE',
            validado INTEGER DEFAULT 0,
            fecha_validacion TEXT,
            usuario_validador TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // Migración automática: Agregar columnas si existe una BD vieja
    try {
        await db.exec('ALTER TABLE pagos ADD COLUMN codigo_seguridad TEXT;');
    } catch (e) {
        // La columna ya existe o falló por otra razón aceptable
    }

    try {
        await db.exec("ALTER TABLE pagos ADD COLUMN banco TEXT DEFAULT 'YAPE';");
    } catch (e) {
        // La columna ya existe
    }

    // Crear índice para optimizar búsquedas frecuentes
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_pagos_timestamp ON pagos(timestamp);
    `);

    console.log(`Conexión de base de datos SQLite establecida en: ${dbPath}`);
    return db;
}

module.exports = { getDatabaseConnection };
