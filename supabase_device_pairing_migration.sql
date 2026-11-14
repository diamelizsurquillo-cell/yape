-- =================================================================================
-- MIGRACION SENSOR ANDROID v2.0: VINCULACION 6 DIGITOS + TELEMETRIA + IDEMPOTENCIA
-- Ejecuta este script en el SQL Editor de Supabase (sin bloques DO $$)
-- =================================================================================

-- 1. Columnas de emparejamiento rápido y estado en vivo del celular en negocios
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS pairing_code TEXT;
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS pairing_expires_at TIMESTAMPTZ;
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS sensor_last_seen TIMESTAMPTZ;
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS sensor_battery INTEGER;
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS sensor_device_name TEXT DEFAULT '';

-- 2. Columna de ID único determinístico por notificación para idempotencia exacta
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS event_uid TEXT;

-- 3. Índices de consulta ultrarrápida
CREATE INDEX IF NOT EXISTS idx_negocios_pairing_code ON public.negocios(pairing_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_negocio_event_uid
  ON public.pagos(negocio_id, event_uid)
  WHERE event_uid IS NOT NULL;
