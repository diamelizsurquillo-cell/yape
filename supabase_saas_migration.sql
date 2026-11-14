-- =========================================================================
-- MIGRACIÓN SAAS MULTI-EMPRESA (VERSIÓN LIMPIA PARA SUPABASE SQL EDITOR)
-- =========================================================================

-- 1. Tabla de Negocios / Clientes Suscriptores
CREATE TABLE IF NOT EXISTS public.negocios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_comercial TEXT NOT NULL,
  ruc_o_telefono TEXT DEFAULT '',
  api_key TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'MENSUAL',
  precio_plan NUMERIC(10,2) DEFAULT 29.90,
  estado TEXT DEFAULT 'ACTIVO',
  fecha_vencimiento TIMESTAMPTZ NOT NULL,
  webhook_url TEXT DEFAULT '',
  whatsapp_alerta TEXT DEFAULT '',
  telegram_chat_id TEXT DEFAULT '',
  notas_admin TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabla de Usuarios por Negocio (Dueños y Cajeros)
CREATE TABLE IF NOT EXISTS public.usuarios_negocio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id UUID REFERENCES public.negocios(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  nombre_mostrar TEXT NOT NULL,
  rol TEXT DEFAULT 'DUENO',
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Columnas para la tabla pagos existente
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES public.negocios(id) ON DELETE CASCADE;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS banco TEXT DEFAULT 'YAPE';
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS codigo_seguridad TEXT;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS usuario_validador TEXT;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS fecha_validacion TIMESTAMPTZ;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS nota_pedido TEXT;

-- 4. Índices de búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_pagos_negocio_timestamp ON public.pagos(negocio_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_negocios_api_key ON public.negocios(api_key);
CREATE INDEX IF NOT EXISTS idx_usuarios_username ON public.usuarios_negocio(username);
