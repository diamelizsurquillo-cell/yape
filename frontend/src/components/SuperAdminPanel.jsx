import React, { useState, useEffect } from 'react';
import {
  Building2, Users, Plus, Copy, Check, ShieldAlert,
  Power, Trash2, Key, RefreshCw, Play, X, Coins, Clock, CheckCircle, Sparkles
} from 'lucide-react';
import { useDeviceViewport } from '../utils/useDeviceViewport';

const SQL_MIGRATION_SNIPPET = `-- Ejecuta este bloque en el SQL Editor de tu proyecto Supabase:
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

ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES public.negocios(id) ON DELETE CASCADE;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS banco TEXT DEFAULT 'YAPE';
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS codigo_seguridad TEXT;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS usuario_validador TEXT;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS fecha_validacion TIMESTAMPTZ;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS nota_pedido TEXT;`;

export default function SuperAdminPanel({ token, apiUrl, onSelectTenantFilter }) {
  const viewport = useDeviceViewport();
  const [negocios, setNegocios] = useState([]);
  const [schemaReady, setSchemaReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedNegocioModal, setSelectedNegocioModal] = useState(null);
  const [copiedId, setCopiedId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const [form, setForm] = useState({
    nombre_comercial: '',
    ruc_o_telefono: '',
    plan: 'MENSUAL',
    dias_vigencia: 30,
    precio_plan: '29.90',
    dueno_username: '',
    dueno_password: '',
    cajero_username: '',
    cajero_password: '',
    webhook_url: '',
    whatsapp_alerta: ''
  });

  const [newUserForm, setNewUserForm] = useState({
    username: '',
    password: '',
    nombre_mostrar: '',
    rol: 'CAJERO'
  });

  useEffect(() => {
    fetchNegocios();
  }, []);

  const showTempMessage = (msg) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(''), 4000);
  };

  const fetchNegocios = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${apiUrl}/api/admin`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setSchemaReady(data.schemaReady !== false);
        setNegocios(data.negocios || []);
      } else {
        setErrorMsg(data.error || 'No se pudo cargar la lista de clientes');
      }
    } catch {
      setErrorMsg('Error de conexión con /api/admin');
    } finally {
      setLoading(false);
    }
  };

  const autoSlug = (name) =>
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 12);

  const handleNameChange = (val) => {
    const slug = autoSlug(val);
    setForm((prev) => ({
      ...prev,
      nombre_comercial: val,
      dueno_username: slug ? `${slug}_admin` : '',
      dueno_password: prev.dueno_password || (slug ? `${slug}2026` : ''),
      cajero_username: slug ? `${slug}_caja` : '',
      cajero_password: prev.cajero_password || 'caja1234'
    }));
  };

  const handlePlanPreset = (planName) => {
    const mapDias = { TRIAL: 7, MENSUAL: 30, ANUAL: 365 };
    const mapPrecio = { TRIAL: '0.00', MENSUAL: '29.90', ANUAL: '299.00' };
    setForm((prev) => ({
      ...prev,
      plan: planName,
      dias_vigencia: mapDias[planName] || 30,
      precio_plan: mapPrecio[planName] || '29.90'
    }));
  };

  const handleCreateNegocio = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const res = await fetch(`${apiUrl}/api/admin`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'create_negocio',
          ...form
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Error al registrar cliente');
        return;
      }
      setShowCreateModal(false);
      setForm({
        nombre_comercial: '',
        ruc_o_telefono: '',
        plan: 'MENSUAL',
        dias_vigencia: 30,
        precio_plan: '29.90',
        dueno_username: '',
        dueno_password: '',
        cajero_username: '',
        cajero_password: '',
        webhook_url: '',
        whatsapp_alerta: ''
      });
      showTempMessage(`Cliente "${data.negocio.nombre_comercial}" creado y activado.`);
      fetchNegocios();
    } catch {
      setErrorMsg('Error de red al crear cliente');
    }
  };

  const handleExtendPlan = async (negocioId, dias, planLabel) => {
    try {
      const res = await fetch(`${apiUrl}/api/admin`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'extend_plan',
          negocio_id: negocioId,
          dias,
          plan: planLabel
        })
      });
      if (res.ok) {
        showTempMessage(`Suscripción renovada +${dias} días.`);
        fetchNegocios();
      }
    } catch {
      setErrorMsg('No se pudo renovar el plan');
    }
  };

  const handleToggleEstado = async (neg) => {
    const nuevoEstado = neg.estado === 'ACTIVO' ? 'SUSPENDIDO' : 'ACTIVO';
    if (
      nuevoEstado === 'SUSPENDIDO' &&
      !window.confirm(`¿Suspender el servicio de "${neg.nombre_comercial}"? No podrá iniciar sesión ni recibir pagos hasta reactivarlo.`)
    ) {
      return;
    }
    try {
      const res = await fetch(`${apiUrl}/api/admin`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'toggle_estado',
          negocio_id: neg.id,
          estado: nuevoEstado
        })
      });
      if (res.ok) {
        showTempMessage(
          nuevoEstado === 'ACTIVO'
            ? `Servicio reactivado para ${neg.nombre_comercial}`
            : `Servicio suspendido para ${neg.nombre_comercial}`
        );
        fetchNegocios();
      }
    } catch {
      setErrorMsg('Error al cambiar estado del negocio');
    }
  };

  const handleDeleteNegocio = async (neg) => {
    if (
      !window.confirm(
        `¿Eliminar permanentemente a "${neg.nombre_comercial}", sus usuarios y su historial de pagos?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`${apiUrl}/api/admin?type=negocio&id=${neg.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        showTempMessage(`Cliente "${neg.nombre_comercial}" eliminado.`);
        fetchNegocios();
      }
    } catch {
      setErrorMsg('Error al eliminar negocio');
    }
  };

  const handleSimulatePayment = async (neg) => {
    try {
      const randomCode = String(Math.floor(100 + Math.random() * 900));
      const res = await fetch(`${apiUrl}/api/pagos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': neg.api_key
        },
        body: JSON.stringify({
          remitente: 'Cliente Demo Yape',
          monto: 25.0,
          timestamp: Math.floor(Date.now() / 1000),
          codigo_seguridad: randomCode,
          banco: 'YAPE'
        })
      });
      const data = await res.json();
      if (res.ok) {
        showTempMessage(
          `Pago simulado S/ 25.00 (Cód: ${randomCode}) enviado a "${neg.nombre_comercial}".`
        );
        fetchNegocios();
      } else {
        alert(data.error || 'No se pudo simular el pago');
      }
    } catch {
      alert('Error al simular pago');
    }
  };

  const handleAddUserToNegocio = async (e) => {
    e.preventDefault();
    if (!selectedNegocioModal) return;
    try {
      const res = await fetch(`${apiUrl}/api/admin`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'create_usuario',
          negocio_id: selectedNegocioModal.id,
          ...newUserForm
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Error al crear usuario');
        return;
      }
      setNewUserForm({ username: '', password: '', nombre_mostrar: '', rol: 'CAJERO' });
      showTempMessage(`Usuario "${data.usuario.username}" agregado.`);
      const updatedRes = await fetch(`${apiUrl}/api/admin`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const updatedData = await updatedRes.json();
      if (updatedRes.ok) {
        setNegocios(updatedData.negocios || []);
        const refreshed = (updatedData.negocios || []).find(
          (n) => n.id === selectedNegocioModal.id
        );
        if (refreshed) setSelectedNegocioModal(refreshed);
      }
    } catch {
      alert('Error de red');
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('¿Eliminar este usuario?')) return;
    const res = await fetch(`${apiUrl}/api/admin?type=usuario&id=${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      fetchNegocios();
      setSelectedNegocioModal((prev) =>
        prev
          ? { ...prev, usuarios: (prev.usuarios || []).filter((u) => u.id !== userId) }
          : null
      );
    }
  };

  const buildWelcomeWhatsAppText = (neg) => {
    const originUrl = window.location.origin;
    const dueno = (neg.usuarios || []).find((u) => u.rol === 'DUENO');
    const cajero = (neg.usuarios || []).find((u) => u.rol === 'CAJERO');
    const vencStr = neg.fecha_vencimiento
      ? new Date(neg.fecha_vencimiento).toLocaleDateString('es-PE')
      : '-';

    let msg = `✅ *BIENVENIDO A VERIFICADOR DE PAGOS YAPE / PLIN / BBVA*\n`;
    msg += `🏪 *Negocio:* ${neg.nombre_comercial}\n`;
    msg += `📅 *Plan:* ${neg.plan} (Vigente hasta: ${vencStr})\n\n`;
    msg += `🌐 *Panel Web (PC / Tablet / Celular):*\n${originUrl}\n\n`;
    if (dueno) {
      msg += `👑 *Acceso Dueño (Reportes y Configuración):*\n`;
      msg += `• Usuario: ${dueno.username}\n`;
      msg += `• Clave: ${dueno.password}\n\n`;
    }
    if (cajero) {
      msg += `🧑‍💼 *Acceso Cajero / Mostrador (Solo valida pagos del día):*\n`;
      msg += `• Usuario: ${cajero.username}\n`;
      msg += `• Clave: ${cajero.password}\n\n`;
    }
    msg += `📱 *Configuración App Android Sensor:*\n`;
    msg += `• URL del Backend: ${originUrl}\n`;
    msg += `• API Key / Token: ${neg.api_key}\n`;
    return msg;
  };

  const copyText = (text, keyId) => {
    navigator.clipboard.writeText(text);
    setCopiedId(keyId);
    setTimeout(() => setCopiedId(''), 2500);
  };

  const getDaysRemaining = (isoDate) => {
    if (!isoDate) return 0;
    const diff = new Date(isoDate).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const activeClients = negocios.filter(
    (n) => n.estado === 'ACTIVO' && getDaysRemaining(n.fecha_vencimiento) >= 0
  );
  const trialClients = activeClients.filter((n) => n.plan === 'TRIAL');
  const expiredOrSuspended = negocios.filter(
    (n) => n.estado !== 'ACTIVO' || getDaysRemaining(n.fecha_vencimiento) < 0
  );
  const mrrEstimado = activeClients.reduce((acc, n) => {
    if (n.plan === 'TRIAL') return acc;
    if (n.plan === 'ANUAL') return acc + Number(n.precio_plan || 0) / 12;
    return acc + Number(n.precio_plan || 0);
  }, 0);

  const renderStatusPill = (neg) => {
    const diasRestantes = getDaysRemaining(neg.fecha_vencimiento);
    const isExpired = diasRestantes < 0;
    const isSuspended = neg.estado !== 'ACTIVO';
    if (isSuspended) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">
          SUSPENDIDO
        </span>
      );
    }
    if (isExpired) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">
          VENCIDO ({Math.abs(diasRestantes)}d)
        </span>
      );
    }
    if (diasRestantes <= 5) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
          Por vencer ({diasRestantes}d)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
        Activo ({diasRestantes}d)
      </span>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {!schemaReady && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-extrabold text-amber-900 text-sm sm:text-base">
                  Inicializa las tablas Multi-Empresa en tu Supabase
                </h3>
                <p className="text-xs sm:text-sm text-amber-800 mt-1">
                  Copia el script SQL, pégalo en el <strong>SQL Editor</strong> de Supabase y presiona <strong>Run</strong>.
                </p>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => copyText(SQL_MIGRATION_SNIPPET, 'sql-mig')}
                className="flex-1 sm:flex-initial justify-center bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl flex items-center gap-2 shadow"
              >
                {copiedId === 'sql-mig' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedId === 'sql-mig' ? '¡Copiado!' : 'Copiar SQL'}</span>
              </button>
              <button
                onClick={fetchNegocios}
                className="bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold text-xs px-3 py-2.5 rounded-xl flex items-center gap-1"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Recargar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {actionMsg && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 px-4 py-3 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span>{actionMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-red-600 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* KPIs Comerciales (2x2 en celular/tablet, 4 columnas en PC) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-3.5 sm:p-5 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] sm:text-xs font-bold text-gray-500 uppercase">Clientes Activos</p>
            <h3 className="text-2xl sm:text-3xl font-black text-gray-900 mt-0.5">{activeClients.length}</h3>
          </div>
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-3.5 sm:p-5 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] sm:text-xs font-bold text-gray-500 uppercase">Ingreso Mes (MRR)</p>
            <h3 className="text-xl sm:text-3xl font-black text-yape mt-0.5">S/ {mrrEstimado.toFixed(0)}</h3>
          </div>
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-purple-50 text-yape flex items-center justify-center flex-shrink-0">
            <Coins className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-3.5 sm:p-5 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] sm:text-xs font-bold text-gray-500 uppercase">En Prueba Gratis</p>
            <h3 className="text-2xl sm:text-3xl font-black text-blue-600 mt-0.5">{trialClients.length}</h3>
          </div>
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-3.5 sm:p-5 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] sm:text-xs font-bold text-gray-500 uppercase">Vencidos / Corte</p>
            <h3 className="text-2xl sm:text-3xl font-black text-red-600 mt-0.5">{expiredOrSuspended.length}</h3>
          </div>
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
            <Clock className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
        </div>
      </div>

      {/* Cabecera de Acción */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-extrabold text-gray-900">
            Gestión de Empresas Suscriptoras y Licencias
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Crea cuentas para tus clientes, entrégales su acceso de Dueño + Cajero y controla sus mensualidades.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchNegocios}
            className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
            title="Refrescar lista"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={!schemaReady}
            className="flex-1 sm:flex-initial justify-center bg-yape hover:bg-yape-dark disabled:opacity-50 text-white font-bold text-sm px-4 py-2.5 rounded-xl shadow-md flex items-center gap-2 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Cliente</span>
          </button>
        </div>
      </div>

      {/* VISTA ADAPTATIVA: TARJETAS TÁCTILES EN CELULAR/TABLET vs TABLA EN PC */}
      {negocios.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">
          Aún no has registrado negocios clientes. Haz clic en <strong>+ Nuevo Cliente</strong> para vender tu primera suscripción.
        </div>
      ) : viewport.useCardLayout ? (
        /* MODO CELULAR Y TABLET: Tarjetas Táctiles Responsivas */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {negocios.map((neg) => {
            const isSuspended = neg.estado !== 'ACTIVO';
            const dueno = (neg.usuarios || []).find((u) => u.rol === 'DUENO');
            const cajerosCount = (neg.usuarios || []).filter((u) => u.rol === 'CAJERO').length;

            return (
              <div
                key={neg.id}
                className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-extrabold text-gray-900 text-base truncate">
                      {neg.nombre_comercial}
                    </h3>
                    <p className="text-xs text-gray-500">
                      {neg.ruc_o_telefono || 'Sin RUC/Tel'} • Plan{' '}
                      <strong className="text-yape">{neg.plan}</strong> (S/ {Number(neg.precio_plan || 0).toFixed(2)})
                    </p>
                  </div>
                  {renderStatusPill(neg)}
                </div>

                <div className="grid grid-cols-2 gap-2 bg-gray-50 p-2.5 rounded-xl text-xs border border-gray-100">
                  <div>
                    <span className="text-gray-400 block text-[10px] uppercase font-bold">Dueño / Cajeros</span>
                    <span className="font-bold text-gray-800">{dueno ? dueno.username : '-'}</span>
                    <span className="text-gray-500 block">{cajerosCount} cajero(s)</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[10px] uppercase font-bold">Volumen Procesado</span>
                    <span className="font-extrabold text-gray-900">
                      S/ {Number(neg.volumen_soles || 0).toFixed(2)}
                    </span>
                    <button
                      onClick={() => onSelectTenantFilter && onSelectTenantFilter(neg)}
                      className="text-blue-600 font-bold block hover:underline"
                    >
                      {neg.total_pagos || 0} pagos (Ver →)
                    </button>
                  </div>
                </div>

                {/* Botones grandes para pantalla táctil */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={() => copyText(buildWelcomeWhatsAppText(neg), `wa-${neg.id}`)}
                    className="bg-emerald-600 active:bg-emerald-700 text-white text-xs font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    {copiedId === `wa-${neg.id}` ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedId === `wa-${neg.id}` ? '¡Copiado!' : 'Kit WhatsApp'}</span>
                  </button>

                  <button
                    onClick={() => setSelectedNegocioModal(neg)}
                    className="bg-purple-50 active:bg-purple-100 text-yape border border-purple-200 text-xs font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <Users className="w-4 h-4" />
                    <span>Usuarios / Key</span>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100">
                  <button
                    onClick={() => handleSimulatePayment(neg)}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1"
                  >
                    <Play className="w-3.5 h-3.5 text-yape" /> Demo S/25
                  </button>
                  <button
                    onClick={() => handleExtendPlan(neg.id, 30, 'MENSUAL')}
                    className="flex-1 bg-blue-600 text-white text-xs font-bold py-2 rounded-lg"
                  >
                    +30 Días
                  </button>
                  <button
                    onClick={() => handleToggleEstado(neg)}
                    className={`p-2 rounded-lg border ${
                      isSuspended
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : 'bg-amber-50 text-amber-700 border-amber-300'
                    }`}
                    title={isSuspended ? 'Reactivar' : 'Suspender'}
                  >
                    <Power className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteNegocio(neg)}
                    className="p-2 rounded-lg text-red-500 bg-red-50"
                    title="Eliminar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* MODO PC / MONITOR DE ESCRITORIO: Tabla Completa */
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                  <th className="px-5 py-3.5">Negocio Cliente</th>
                  <th className="px-5 py-3.5">Plan / Tarifa</th>
                  <th className="px-5 py-3.5">Vigencia</th>
                  <th className="px-5 py-3.5">Accesos (Dueño / Caja)</th>
                  <th className="px-5 py-3.5">Uso Total</th>
                  <th className="px-5 py-3.5 text-right">Acciones Comerciales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                {negocios.map((neg) => {
                  const isSuspended = neg.estado !== 'ACTIVO';
                  const dueno = (neg.usuarios || []).find((u) => u.rol === 'DUENO');
                  const cajerosCount = (neg.usuarios || []).filter((u) => u.rol === 'CAJERO').length;

                  return (
                    <tr key={neg.id} className="hover:bg-gray-50/80 transition">
                      <td className="px-5 py-3.5">
                        <div className="font-bold text-gray-900">{neg.nombre_comercial}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {neg.ruc_o_telefono || 'Sin RUC/Tel'} •{' '}
                          <button
                            onClick={() => copyText(neg.api_key, `key-${neg.id}`)}
                            className="text-yape hover:underline font-mono"
                            title="Copiar API Key del APK"
                          >
                            {copiedId === `key-${neg.id}` ? '¡API Key copiada!' : `${neg.api_key.slice(0, 14)}...`}
                          </button>
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-extrabold ${
                            neg.plan === 'TRIAL'
                              ? 'bg-blue-100 text-blue-800'
                              : neg.plan === 'ANUAL'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {neg.plan}
                        </span>
                        <div className="text-xs font-semibold text-gray-500 mt-1">
                          S/ {Number(neg.precio_plan || 0).toFixed(2)}
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        {renderStatusPill(neg)}
                        <div className="text-[11px] text-gray-400 mt-1">
                          Vence: {new Date(neg.fecha_vencimiento).toLocaleDateString('es-PE')}
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        {dueno && (
                          <div className="text-xs">
                            <span className="font-bold text-gray-700">Dueño:</span>{' '}
                            <code className="bg-gray-100 px-1.5 py-0.5 rounded">{dueno.username}</code>
                          </div>
                        )}
                        <div className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" />
                          <span>{cajerosCount} cajero(s)</span>
                          <button
                            onClick={() => setSelectedNegocioModal(neg)}
                            className="text-yape font-bold hover:underline ml-1"
                          >
                            Gestionar
                          </button>
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="font-bold text-gray-800">
                          S/ {Number(neg.volumen_soles || 0).toFixed(2)}
                        </div>
                        <button
                          onClick={() => onSelectTenantFilter && onSelectTenantFilter(neg)}
                          className="text-xs text-blue-600 hover:underline font-semibold"
                        >
                          {neg.total_pagos || 0} cobros (Ver pagos →)
                        </button>
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            onClick={() => copyText(buildWelcomeWhatsAppText(neg), `wa-${neg.id}`)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 shadow-sm transition"
                            title="Copiar mensaje completo de bienvenida para WhatsApp"
                          >
                            {copiedId === `wa-${neg.id}` ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedId === `wa-${neg.id}` ? '¡Copiado!' : 'Kit WhatsApp'}</span>
                          </button>

                          <button
                            onClick={() => handleSimulatePayment(neg)}
                            className="bg-purple-100 hover:bg-purple-200 text-yape text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition"
                            title="Enviar un pago Yape de prueba de S/ 25.00"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>Demo</span>
                          </button>

                          <button
                            onClick={() => handleExtendPlan(neg.id, 30, 'MENSUAL')}
                            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition"
                            title="Renovar suscripción +30 días"
                          >
                            +30d
                          </button>

                          <button
                            onClick={() => handleToggleEstado(neg)}
                            className={`p-1.5 rounded-lg border transition ${
                              isSuspended
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                                : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                            }`}
                            title={isSuspended ? 'Reactivar servicio' : 'Suspender por falta de pago'}
                          >
                            <Power className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleDeleteNegocio(neg)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                            title="Eliminar negocio"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL RESPONSIVO: CREAR NUEVO CLIENTE (Cabecera y Pie fijos, cuerpo con scroll suave) */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-3">
          <form
            onSubmit={handleCreateNegocio}
            className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 max-h-[94dvh] sm:max-h-[90dvh] flex flex-col overflow-hidden"
          >
            {/* Cabecera fija siempre visible */}
            <div className="px-4 sm:px-6 py-3.5 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-white">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-gray-900">
                  Registrar Nuevo Cliente (Negocio)
                </h3>
                <p className="text-[11px] sm:text-xs text-gray-500">
                  Genera su API Key exclusiva, cuenta de Dueño y cuenta de Cajero.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Cuerpo adaptable con scroll interno */}
            <div
              className={`px-4 sm:px-6 overflow-y-auto modal-scroll flex-1 text-sm ${
                viewport.isCompactHeight ? 'py-3 space-y-3' : 'py-4 space-y-4'
              }`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-600 uppercase mb-1">
                    Nombre Comercial *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Pollería El Dorado"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yape outline-none"
                    value={form.nombre_comercial}
                    onChange={(e) => handleNameChange(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-600 uppercase mb-1">
                    RUC o WhatsApp del Cliente
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: 999888777"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yape outline-none"
                    value={form.ruc_o_telefono}
                    onChange={(e) => setForm({ ...form, ruc_o_telefono: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-600 uppercase mb-1">
                  Tipo de Plan y Vigencia
                </label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {[
                    { id: 'TRIAL', label: 'Trial 7d (S/ 0)' },
                    { id: 'MENSUAL', label: 'Mes 30d (S/ 29.9)' },
                    { id: 'ANUAL', label: 'Año 365d (S/ 299)' }
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handlePlanPreset(p.id)}
                      className={`py-2 px-1.5 rounded-lg text-[11px] sm:text-xs font-bold border transition ${
                        form.plan === p.id
                          ? 'bg-yape text-white border-yape shadow-sm'
                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500">Días activos</label>
                    <input
                      type="number"
                      min="1"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg"
                      value={form.dias_vigencia}
                      onChange={(e) => setForm({ ...form, dias_vigencia: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500">Precio cobrado (S/)</label>
                    <input
                      type="number"
                      step="0.10"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg"
                      value={form.precio_plan}
                      onChange={(e) => setForm({ ...form, precio_plan: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="p-3 bg-purple-50/60 border border-purple-200 rounded-xl">
                <div className="text-[11px] font-extrabold text-yape uppercase mb-2">
                  👑 Cuenta del Dueño (Acceso Completo y Reportes)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    required
                    placeholder="Usuario dueño"
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg"
                    value={form.dueno_username}
                    onChange={(e) => setForm({ ...form, dueno_username: e.target.value })}
                  />
                  <input
                    type="text"
                    required
                    placeholder="Contraseña dueño"
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg"
                    value={form.dueno_password}
                    onChange={(e) => setForm({ ...form, dueno_password: e.target.value })}
                  />
                </div>
              </div>

              <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl">
                <div className="text-[11px] font-extrabold text-emerald-800 uppercase mb-2">
                  🧑‍💼 Cuenta de Cajero / Mostrador (Opcional - No borra pagos)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    placeholder="Usuario cajero"
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg"
                    value={form.cajero_username}
                    onChange={(e) => setForm({ ...form, cajero_username: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="Contraseña cajero"
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg"
                    value={form.cajero_password}
                    onChange={(e) => setForm({ ...form, cajero_password: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-600 uppercase mb-1">
                  Webhook URL para WooCommerce / Facturador (Opcional)
                </label>
                <input
                  type="url"
                  placeholder="https://mitienda.com/wp-json/yapay/v1/webhook"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs"
                  value={form.webhook_url}
                  onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
                />
              </div>
            </div>

            {/* Pie fijo siempre visible */}
            <div className="px-4 sm:px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2 flex-shrink-0 pb-safe">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 font-bold text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-yape hover:bg-yape-dark text-white font-bold text-xs shadow-md"
              >
                Crear Cliente y Generar API Key
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL RESPONSIVO: DETALLE DE USUARIOS Y API KEY */}
      {selectedNegocioModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-3">
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 max-h-[92dvh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-extrabold text-gray-900 truncate">
                  {selectedNegocioModal.nombre_comercial}
                </h3>
                <p className="text-xs text-gray-500">
                  Credenciales de cajeros y llave para el APK Android
                </p>
              </div>
              <button
                onClick={() => setSelectedNegocioModal(null)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto modal-scroll flex-1 space-y-4">
              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-600 uppercase flex items-center gap-1">
                    <Key className="w-3.5 h-3.5 text-yape" /> API Key del Sensor Android
                  </span>
                  <button
                    onClick={() =>
                      copyText(selectedNegocioModal.api_key, `modal-key-${selectedNegocioModal.id}`)
                    }
                    className="text-xs font-bold text-yape hover:underline"
                  >
                    {copiedId === `modal-key-${selectedNegocioModal.id}` ? '¡Copiada!' : 'Copiar Key'}
                  </button>
                </div>
                <code className="block text-xs bg-white p-2 rounded border border-gray-200 break-all text-gray-800">
                  {selectedNegocioModal.api_key}
                </code>
                <div className="text-[11px] text-gray-500 mt-1.5">
                  URL Servidor: <code>{window.location.origin}</code>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-gray-600 uppercase mb-2">
                  Usuarios Registrados ({(selectedNegocioModal.usuarios || []).length})
                </h4>
                <div className="space-y-2">
                  {(selectedNegocioModal.usuarios || []).map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-200 text-xs"
                    >
                      <div className="min-w-0">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-extrabold mr-2 ${
                            u.rol === 'DUENO'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {u.rol}
                        </span>
                        <span className="font-bold text-gray-900">{u.username}</span>
                        <span className="text-gray-400 ml-2">Clave: {u.password}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteUser(u.id)}
                        className="text-gray-400 hover:text-red-600 p-1"
                        title="Eliminar usuario"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <form
                onSubmit={handleAddUserToNegocio}
                className="p-3.5 bg-emerald-50/50 border border-emerald-200 rounded-xl space-y-2.5"
              >
                <div className="text-xs font-extrabold text-emerald-900 uppercase">
                  + Agregar Cajero o Sucursal Adicional
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Usuario (ej. caja2)"
                    className="px-2.5 py-2 bg-white border border-gray-300 rounded-lg text-xs"
                    value={newUserForm.username}
                    onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                  />
                  <input
                    type="text"
                    required
                    placeholder="Contraseña"
                    className="px-2.5 py-2 bg-white border border-gray-300 rounded-lg text-xs"
                    value={newUserForm.password}
                    onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  />
                  <select
                    className="px-2.5 py-2 bg-white border border-gray-300 rounded-lg text-xs font-semibold"
                    value={newUserForm.rol}
                    onChange={(e) => setNewUserForm({ ...newUserForm, rol: e.target.value })}
                  >
                    <option value="CAJERO">Rol: CAJERO</option>
                    <option value="DUENO">Rol: DUEÑO</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 rounded-lg transition"
                >
                  Agregar Usuario
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
