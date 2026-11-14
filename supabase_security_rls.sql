-- =================================================================================
-- BLINDAJE DE SEGURIDAD RLS PARA SUPABASE (CIERRE DE VULNERABILIDAD SEC-01)
-- IMPORTANTE: Ejecuta este script DESPUES de configurar SUPABASE_SERVICE_ROLE_KEY
-- en las Variables de Entorno de Vercel (Settings -> Environment Variables).
-- =================================================================================

-- 1. Activar Row Level Security (RLS) en las 3 tablas críticas del SaaS
ALTER TABLE public.negocios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_negocio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

-- 2. Eliminar cualquier política abierta previa si existiera
DROP POLICY IF EXISTS "Permitir lectura publica" ON public.negocios;
DROP POLICY IF EXISTS "Permitir lectura publica" ON public.usuarios_negocio;
DROP POLICY IF EXISTS "Permitir lectura publica" ON public.pagos;
DROP POLICY IF EXISTS "Allow anon access" ON public.negocios;
DROP POLICY IF EXISTS "Allow anon access" ON public.usuarios_negocio;
DROP POLICY IF EXISTS "Allow anon access" ON public.pagos;

-- 3. Revocar permisos directos de los roles públicos del navegador (anon / authenticated)
-- Tu backend en Vercel (/api/*) seguirá operando al 100% usando SUPABASE_SERVICE_ROLE_KEY,
-- mientras que cualquier intento externo de leer tablas desde la consola web será bloqueado.
REVOKE ALL ON TABLE public.negocios FROM anon, authenticated;
REVOKE ALL ON TABLE public.usuarios_negocio FROM anon, authenticated;
REVOKE ALL ON TABLE public.pagos FROM anon, authenticated;
