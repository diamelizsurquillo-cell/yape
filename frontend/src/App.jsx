import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  Search, LogOut, CheckCircle, Clock,
  Coins, Filter, Calendar, RefreshCw,
  Smartphone, ShieldAlert, Check, Trash2,
  Volume2, VolumeX, Volume1, Settings, Play, Sparkles, X,
  Bell, BellRing, BellOff, ExternalLink, AppWindow
} from 'lucide-react';
import { speakPayment, formatAmountToSpeech, playChime } from './utils/soundAlert';
import { supabase, isSupabaseConfigured } from './utils/supabaseClient';
import { requestNotificationPermission, showDesktopNotification } from './utils/desktopNotification';
import { openYapeFloatingWidget, updateFloatingWidget, isPipSupported } from './utils/pipWidget';

const API_URL = import.meta.env.VITE_API_URL || '';

function App() {
  const [token, setToken] = useState(localStorage.getItem('yape_token') || (isSupabaseConfigured ? 'supabase_session' : ''));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Dashboard State
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '' = Todos, '0' = Pendientes, '1' = Validados
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [stats, setStats] = useState({ totalToday: 0, pendingCount: 0, validatedCount: 0 });

  // Sound / Voice announcement state
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem('yape_sound_enabled') !== 'false');
  const [includeSender, setIncludeSender] = useState(localStorage.getItem('yape_sound_sender') === 'true');
  const [soundVolume, setSoundVolume] = useState(parseFloat(localStorage.getItem('yape_sound_volume') || '1.0'));
  const [showSoundModal, setShowSoundModal] = useState(false);
  const [lastAnnouncedId, setLastAnnouncedId] = useState(null);

  // Desktop Background Notifications & Floating Toast
  const [desktopNotifications, setDesktopNotifications] = useState(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
  );
  const [activeToast, setActiveToast] = useState(null);
  const toastTimeoutRef = useRef(null);

  const socketRef = useRef(null);
  const soundSettingsRef = useRef({ soundEnabled, includeSender, soundVolume });

  // Keep ref synchronized with state to prevent stale closures in websocket listeners
  useEffect(() => {
    soundSettingsRef.current = { soundEnabled, includeSender, soundVolume };
    localStorage.setItem('yape_sound_enabled', soundEnabled.toString());
    localStorage.setItem('yape_sound_sender', includeSender.toString());
    localStorage.setItem('yape_sound_volume', soundVolume.toString());
  }, [soundEnabled, includeSender, soundVolume]);

  const handleIncomingPayment = (nuevoPago) => {
    setPayments((prev) => {
      if (prev.some((p) => p.id === nuevoPago.id)) return prev;
      return [nuevoPago, ...prev];
    });

    // 🔊 1. ANUNCIAR PAGO POR VOZ EN EL PARLANTE
    const { soundEnabled: isSoundOn, includeSender: withSender, soundVolume: vol } = soundSettingsRef.current;
    if (isSoundOn) {
      speakPayment({
        monto: nuevoPago.monto,
        remitente: nuevoPago.remitente,
        soundEnabled: true,
        includeSender: withSender,
        volume: vol
      });
      setLastAnnouncedId(nuevoPago.id);
    }

    // 🔔 2. NOTIFICACIÓN DE ESCRITORIO / SEGUNDO PLANO (Aparece sobre otras apps o pestañas)
    showDesktopNotification({
      monto: nuevoPago.monto,
      remitente: nuevoPago.remitente,
      codigo_seguridad: nuevoPago.codigo_seguridad
    });

    // 🪟 3. ACTUALIZAR MINI-WIDGET FLOTANTE PiP
    updateFloatingWidget(nuevoPago);

    // 📱 4. POPUP FLOTANTE EN LA PARTE INFERIOR DE LA PANTALLA
    setActiveToast(nuevoPago);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setActiveToast(null);
    }, 8000);
  };

  // Auto-login verify
  useEffect(() => {
    if (token) {
      fetchPayments();
      // Setup Realtime: Supabase or WebSockets
      if (isSupabaseConfigured && supabase) {
        setupSupabaseRealtime();
      } else {
        setupWebSocket();
      }
    }
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [token]);

  // Recalcular métricas cuando cambia la lista de pagos
  useEffect(() => {
    calculateStats();
  }, [payments]);

  const setupSupabaseRealtime = () => {
    const channel = supabase
      .channel('pagos-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pagos' },
        (payload) => {
          handleIncomingPayment(payload.new);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pagos' },
        (payload) => {
          const pagoActualizado = payload.new;
          setPayments((prev) =>
            prev.map((p) => (p.id === pagoActualizado.id ? pagoActualizado : p))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const setupWebSocket = () => {
    // Intentar conectar con la URL de la API o el origin actual
    const socketHost = import.meta.env.VITE_API_URL || window.location.origin;
    socketRef.current = io(socketHost);

    socketRef.current.on('nuevo_pago', (nuevoPago) => {
      handleIncomingPayment(nuevoPago);
    });

    socketRef.current.on('pago_validado', (pagoActualizado) => {
      setPayments((prev) =>
        prev.map((p) => (p.id === pagoActualizado.id ? pagoActualizado : p))
      );
    });

    socketRef.current.on('pagos_limpiados', () => {
      setPayments([]);
    });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem('yape_token', data.token);
        setToken(data.token);
      } else {
        setLoginError(data.error || 'Credenciales inválidas');
      }
    } catch (err) {
      setLoginError('Error de conexión con el servidor backend');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('yape_token');
    setToken('');
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
  };

  const fetchPayments = async () => {
    setLoading(true);
    try {
      if (isSupabaseConfigured && supabase) {
        let query = supabase.from('pagos').select('*').order('timestamp', { ascending: false });
        if (statusFilter !== '') {
          query = query.eq('validado', parseInt(statusFilter));
        }
        if (searchTerm) {
          query = query.ilike('remitente', `%${searchTerm}%`);
        }
        const { data, error } = await query;
        if (!error && data) {
          setPayments(data);
        }
        return;
      }

      // Construir query string de filtros para Backend tradicional
      const queryParams = new URLSearchParams();
      if (startDate) queryParams.append('fecha_inicio', startDate);
      if (endDate) queryParams.append('fecha_fin', endDate);
      if (statusFilter !== '') queryParams.append('validado', statusFilter);
      if (searchTerm) queryParams.append('search', searchTerm);

      const res = await fetch(`${API_URL}/api/pagos?${queryParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }

      const data = await res.json();
      if (res.ok) {
        setPayments(data);
      }
    } catch (err) {
      console.error('Error al cargar pagos:', err);
    } finally {
      setLoading(false);
    }
  };

  const validatePayment = async (id) => {
    try {
      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase
          .from('pagos')
          .update({
            validado: 1,
            fecha_validacion: new Date().toISOString(),
            usuario_validador: 'admin'
          })
          .eq('id', id)
          .select()
          .single();

        if (!error && data) {
          setPayments((prev) => prev.map((p) => (p.id === id ? data : p)));
        }
        return;
      }

      const res = await fetch(`${API_URL}/api/pagos/${id}/validar`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setPayments((prev) =>
          prev.map((p) => (p.id === id ? data.pago : p))
        );
      }
    } catch (err) {
      console.error('Error al validar pago:', err);
    }
  };

  const calculateStats = () => {
    // Filtrar solo los pagos que corresponden al día de hoy para las tarjetas superiores
    const hoy = new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima' });

    const pagosDeHoy = payments.filter(p => {
      // timestamp está en segundos (enviado por android app), multiplicamos por 1000
      const fechaPago = new Date(p.timestamp * 1000).toLocaleDateString('es-PE', { timeZone: 'America/Lima' });
      return fechaPago === hoy;
    });

    let total = 0;
    let pending = 0;
    let validated = 0;

    pagosDeHoy.forEach(p => {
      total += p.monto;
      if (p.validado === 1) {
        validated++;
      } else {
        pending++;
      }
    });

    setStats({
      totalToday: total,
      pendingCount: pending,
      validatedCount: validated
    });
  };

  const formatFecha = (epochSeconds) => {
    const d = new Date(epochSeconds * 1000);
    return d.toLocaleString('es-PE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const formatFechaValidacion = (isoString) => {
    if (!isoString) return '-';
    const d = new Date(isoString);
    return d.toLocaleString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const handleApplyFilters = (e) => {
    e.preventDefault();
    fetchPayments();
  };

  const handleClearFilters = () => {
    setStartDate('');
    setEndDate('');
    setStatusFilter('');
    setSearchTerm('');
    // Forzar la consulta limpia ejecutándola en el siguiente ciclo
    setTimeout(() => fetchPayments(), 50);
  };

  const clearAllPayments = async () => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar TODO el historial de pagos? Esta acción no se puede deshacer.')) return;
    try {
      const res = await fetch(`${API_URL}/api/pagos`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setPayments([]);
      }
    } catch (err) {
      console.error('Error al limpiar pagos:', err);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-tr from-yape-dark via-yape to-yape-light p-4">
        <div className="bg-white/95 backdrop-blur-md p-8 rounded-2xl shadow-2xl w-full max-w-md border border-white/20">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-yape/10 text-yape mb-3">
              <Coins className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">YAPE Notification Monitor</h1>
            <p className="text-sm text-gray-500 mt-1">Dashboard de Consulta de Pagos</p>
          </div>

          {loginError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 flex items-center gap-2 border border-red-200">
              <ShieldAlert className="w-5 h-5 flex-shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Usuario</label>
              <input
                type="text"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yape focus:border-transparent outline-none transition"
                placeholder="Ingresa tu usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Contraseña</label>
              <input
                type="password"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yape focus:border-transparent outline-none transition"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="w-full bg-yape hover:bg-yape-dark text-white font-bold py-2.5 px-4 rounded-lg shadow-lg hover:shadow-xl transition duration-200 flex items-center justify-center"
            >
              Iniciar Sesión
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-12">
      {/* Navbar Superior */}
      <nav className="bg-yape text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <Coins className="w-6 h-6 text-white" />
              <span className="font-bold text-lg tracking-wide">YAPE MONITOR</span>
              <span className="hidden sm:inline bg-yape-dark text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border border-white/20">
                Interno
              </span>
            </div>
            <div className="flex items-center gap-3">
              {/* Botón Rápido Parlante On/Off */}
              <button
                onClick={() => {
                  const newState = !soundEnabled;
                  setSoundEnabled(newState);
                  if (newState) {
                    playChime(soundVolume);
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition border shadow-sm ${soundEnabled
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-400'
                    : 'bg-red-500/90 hover:bg-red-600 text-white border-red-400'
                  }`}
                title={soundEnabled ? 'Parlante Activado (Clic para silenciar)' : 'Parlante Silenciado (Clic para activar)'}
              >
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                <span className="hidden sm:inline">{soundEnabled ? 'Parlante: ON' : 'Parlante: MUTED'}</span>
              </button>

              {/* Botón Notificaciones en Segundo Plano / Escritorio */}
              <button
                onClick={async () => {
                  const perm = await requestNotificationPermission();
                  setDesktopNotifications(perm === 'granted');
                  if (perm === 'granted') {
                    showDesktopNotification({
                      monto: 50,
                      remitente: 'Cliente de Prueba',
                      codigo_seguridad: '999'
                    });
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition border shadow-sm ${desktopNotifications
                    ? 'bg-purple-900/60 hover:bg-purple-900 text-white border-purple-400'
                    : 'bg-amber-500/90 hover:bg-amber-600 text-white border-amber-300'
                  }`}
                title={desktopNotifications ? 'Notificaciones en segundo plano activadas' : 'Activar alertas en segundo plano (otra ventana/app)'}
              >
                {desktopNotifications ? <BellRing className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                <span className="hidden md:inline">{desktopNotifications ? 'Alertas: ON' : 'Activar Alertas'}</span>
              </button>

              {/* Botón Mini-Ventana Flotante Always on Top */}
              <button
                onClick={async () => {
                  await openYapeFloatingWidget({
                    onValidatePayment: (id) => validatePayment(id)
                  });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition border shadow-sm bg-blue-600 hover:bg-blue-700 text-white border-blue-400"
                title="Abrir Mini-Ventana Flotante SIEMPRE VISIBLE encima de otras aplicaciones (Excel, WhatsApp, etc.)"
              >
                <AppWindow className="w-4 h-4" />
                <span className="hidden lg:inline">Ventana Flotante</span>
              </button>

              {/* Botón Configuración de Audio / Probar */}
              <button
                onClick={() => setShowSoundModal(true)}
                className="p-2 rounded-full hover:bg-white/10 transition text-white"
                title="Configuración de Voz y Notificaciones"
              >
                <Settings className="w-5 h-5" />
              </button>

              <div className="h-6 w-px bg-white/20"></div>

              <button
                onClick={fetchPayments}
                disabled={loading}
                className="p-2 rounded-full hover:bg-white/10 transition text-white"
                title="Actualizar Datos"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={clearAllPayments}
                className="p-2 rounded-full hover:bg-red-500/30 transition text-white"
                title="Limpiar Todo el Historial"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <div className="h-6 w-px bg-white/20"></div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yape-dark hover:bg-red-700 transition text-sm font-semibold text-white"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Salir</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Cuerpo Principal */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">

        {/* Contadores / Tarjetas de Resumen (Del día de hoy) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Card Total Hoy */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-500 uppercase">Recaudado Hoy</p>
              <h3 className="text-3xl font-extrabold text-gray-800 mt-1">S/ {stats.totalToday.toFixed(2)}</h3>
            </div>
            <div className="w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center">
              <Coins className="w-6 h-6" />
            </div>
          </div>

          {/* Card Validados */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-500 uppercase">Validados Hoy</p>
              <h3 className="text-3xl font-extrabold text-green-600 mt-1">{stats.validatedCount}</h3>
            </div>
            <div className="w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center">
              <CheckCircle className="w-6 h-6" />
            </div>
          </div>

          {/* Card Pendientes */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-500 uppercase">Pendientes Hoy</p>
              <h3 className="text-3xl font-extrabold text-yellow-600 mt-1">{stats.pendingCount}</h3>
            </div>
            <div className="w-12 h-12 rounded-full bg-yellow-50 text-yellow-600 flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Panel de Filtros */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
          <div className="flex items-center gap-1.5 border-b border-gray-100 pb-3 mb-4 text-gray-700">
            <Filter className="w-5 h-5" />
            <h2 className="font-bold text-base">Filtros y Búsqueda</h2>
          </div>
          <form onSubmit={handleApplyFilters} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Remitente / Monto</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Buscar..."
                  className="w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-yape focus:border-transparent outline-none"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Desde Fecha</label>
              <div className="relative">
                <input
                  type="date"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-yape focus:border-transparent outline-none"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Hasta Fecha</label>
              <div className="relative">
                <input
                  type="date"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-yape focus:border-transparent outline-none"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Estado</label>
              <select
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-yape focus:border-transparent outline-none bg-white"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">Todos los pagos</option>
                <option value="0">Pendientes</option>
                <option value="1">Validados</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-yape hover:bg-yape-dark text-white font-bold py-1.5 px-4 rounded-lg text-sm shadow-sm transition"
              >
                Filtrar
              </button>
              <button
                type="button"
                onClick={handleClearFilters}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-1.5 px-4 rounded-lg text-sm transition"
              >
                Limpiar
              </button>
            </div>
          </form>
        </div>

        {/* Tabla / Lista de Pagos */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-3.5">Remitente</th>
                  <th className="px-6 py-3.5">Monto</th>
                  <th className="px-6 py-3.5">Fecha y Hora</th>
                  <th className="px-6 py-3.5">Cód. Seguridad</th>
                  <th className="px-6 py-3.5">Estado</th>
                  <th className="px-6 py-3.5 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                {loading && payments.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-10 text-gray-400">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-yape" />
                      Cargando registros...
                    </td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-10 text-gray-400">
                      No se encontraron pagos con los filtros seleccionados
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr
                      key={p.id}
                      className={`hover:bg-gray-50 transition duration-150 ${p.validado === 0 ? 'bg-yellow-50/20' : ''}`}
                    >
                      <td className="px-6 py-4 font-semibold text-gray-900">{p.remitente}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-yape text-base">S/ {p.monto.toFixed(2)}</span>
                          <button
                            onClick={() => speakPayment({
                              monto: p.monto,
                              remitente: p.remitente,
                              soundEnabled: true,
                              includeSender,
                              volume: soundVolume
                            })}
                            className="p-1 rounded text-gray-400 hover:text-yape hover:bg-yape/10 transition"
                            title="Escuchar locución en el parlante"
                          >
                            <Volume2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-500">{formatFecha(p.timestamp)}</td>
                      <td className="px-6 py-4 text-sm font-semibold text-gray-600">
                        {p.codigo_seguridad || '-'}
                      </td>
                      <td className="px-6 py-4">
                        {p.validado === 1 ? (
                          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800">
                            <Check className="w-3.5 h-3.5" />
                            <span>Validado ({formatFechaValidacion(p.fecha_validacion)})</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Pendiente</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {p.validado === 0 ? (
                          <button
                            onClick={() => validatePayment(p.id)}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-1 px-3 rounded-lg text-xs shadow-sm hover:shadow transition"
                          >
                            Validar
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400 font-medium">
                            Por: {p.usuario_validador || 'admin'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Modal de Configuración y Prueba del Parlante */}
      {showSoundModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-gray-100 relative">
            <button
              onClick={() => setShowSoundModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-yape/10 text-yape flex items-center justify-center">
                <Volume2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">Configuración del Parlante</h3>
                <p className="text-xs text-gray-500">Anuncios de voz al recibir pagos en tiempo real</p>
              </div>
            </div>

            <div className="space-y-4 text-sm text-gray-700">
              {/* Switch Activar Sonido */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div>
                  <span className="font-semibold block">Voz en Parlante</span>
                  <span className="text-xs text-gray-500">Decir "¡Yape!" y el monto al llegar un pago</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(e) => setSoundEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-yape"></div>
                </label>
              </div>

              {/* Switch Incluir Remitente */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div>
                  <span className="font-semibold block">Mencionar Cliente</span>
                  <span className="text-xs text-gray-500">Ej: "¡Yape! 50 soles de Juan Perez"</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeSender}
                    onChange={(e) => setIncludeSender(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-yape"></div>
                </label>
              </div>

              {/* Slider de Volumen */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold">Volumen de Voz</span>
                  <span className="text-xs font-bold text-yape">{Math.round(soundVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={soundVolume}
                  onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-yape"
                />
              </div>

              {/* Switch Notificaciones de Escritorio / Segundo Plano */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div>
                  <span className="font-semibold block">Alertas en Segundo Plano</span>
                  <span className="text-xs text-gray-500">Aparecer en Windows / Mac incluso en otra ventana</span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const perm = await requestNotificationPermission();
                    const isGranted = perm === 'granted';
                    setDesktopNotifications(isGranted);
                    if (isGranted) {
                      showDesktopNotification({
                        monto: 50,
                        remitente: 'Cliente de Prueba',
                        codigo_seguridad: '999'
                      });
                    }
                  }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${desktopNotifications
                      ? 'bg-purple-700 text-white hover:bg-purple-800'
                      : 'bg-yape text-white hover:bg-yape-dark'
                    }`}
                >
                  {desktopNotifications ? 'Permitido (ON)' : 'Activar Permiso'}
                </button>
              </div>

              {/* Botón de Prueba */}
              <div className="pt-2 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    speakPayment({
                      monto: 50.00,
                      remitente: includeSender ? 'Juan Pérez' : '',
                      soundEnabled: true,
                      includeSender,
                      volume: soundVolume
                    });
                    showDesktopNotification({
                      monto: 50.00,
                      remitente: includeSender ? 'Juan Pérez' : '',
                      codigo_seguridad: '123'
                    });
                    setActiveToast({
                      id: 999,
                      monto: 50.00,
                      remitente: 'Juan Pérez (Prueba)',
                      codigo_seguridad: '123'
                    });
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-yape to-yape-dark hover:opacity-95 text-white font-bold py-2.5 px-4 rounded-xl shadow-md transition"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>Probar Notificación y Voz Completa (S/ 50.00)</span>
                </button>
                <p className="text-[11px] text-gray-400 text-center">
                  🔔 Suena campana, habla por parlante y muestra la ventana flotante en pantalla y segundo plano.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowSoundModal(false)}
                className="bg-gray-800 hover:bg-gray-900 text-white text-xs font-bold py-2 px-5 rounded-lg transition"
              >
                Cerrar y Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ventana / Banner Flotante de Notificación en la parte inferior */}
      {activeToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border-2 border-yape p-4 transition-all duration-300 transform translate-y-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-yape to-yape-light text-white flex items-center justify-center flex-shrink-0 shadow-md">
                <Coins className="w-7 h-7" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                  <span className="text-xs font-bold text-yape uppercase tracking-wider">¡Yape Recibido!</span>
                </div>
                <h4 className="text-2xl font-black text-gray-900 mt-0.5">
                  S/ {Number(activeToast.monto).toFixed(2)}
                </h4>
                <p className="text-xs font-semibold text-gray-600 truncate max-w-[180px]">
                  {activeToast.remitente || 'Cliente'}
                </p>
                {activeToast.codigo_seguridad && (
                  <span className="inline-block text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded mt-1">
                    Cód: {activeToast.codigo_seguridad}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => setActiveToast(null)}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition"
              title="Cerrar notificación"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between">
            <span className="text-[11px] text-gray-400">Hace unos segundos</span>
            <button
              onClick={() => {
                validatePayment(activeToast.id);
                setActiveToast(null);
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-1 rounded-lg transition flex items-center gap-1 shadow-sm"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Validar Pago</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
