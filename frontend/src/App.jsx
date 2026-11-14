import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  Search, LogOut, CheckCircle, Clock,
  Coins, Filter, RefreshCw,
  ShieldAlert, Check, Trash2,
  Volume2, VolumeX, Settings, Play, X,
  BellRing, BellOff, AppWindow, Building2, Users, ExternalLink, Smartphone, Download
} from 'lucide-react';
import { speakPayment, playChime } from './utils/soundAlert';
import { supabase, isSupabaseConfigured } from './utils/supabaseClient';
import { requestNotificationPermission, showDesktopNotification } from './utils/desktopNotification';
import { openYapeFloatingWidget, updateFloatingWidget, isPipSupported } from './utils/pipWidget';
import { useDeviceViewport } from './utils/useDeviceViewport';
import { usePwaInstall } from './utils/usePwaInstall';
import SuperAdminPanel from './components/SuperAdminPanel';
import TenantSettingsModal from './components/TenantSettingsModal';
import PwaInstallModal from './components/PwaInstallModal';

const API_URL = import.meta.env.VITE_API_URL || '';

function loadInitialSession() {
  const savedToken = localStorage.getItem('yape_token') || '';
  const savedUserRaw = localStorage.getItem('yape_user');
  if (!savedToken || !savedToken.includes('.')) {
    localStorage.removeItem('yape_token');
    localStorage.removeItem('yape_user');
    return { token: '', user: null };
  }
  try {
    const parsedUser = savedUserRaw ? JSON.parse(savedUserRaw) : null;
    return { token: savedToken, user: parsedUser };
  } catch {
    return { token: '', user: null };
  }
}

function App() {
  const viewport = useDeviceViewport();
  const pwa = usePwaInstall();
  const initialSession = loadInitialSession();
  const [token, setToken] = useState(initialSession.token);
  const [currentUser, setCurrentUser] = useState(initialSession.user);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Navegación ('pagos' | 'clientes')
  const [activeTab, setActiveTab] = useState(
    initialSession.user?.rol === 'SUPERADMIN' ? 'clientes' : 'pagos'
  );
  const [superAdminTenantFilter, setSuperAdminTenantFilter] = useState(null);
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Dashboard State
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [quickCodeSearch, setQuickCodeSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [bankFilter, setBankFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [stats, setStats] = useState({ totalToday: 0, pendingCount: 0, validatedCount: 0 });

  // Sound / Voice state
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem('yape_sound_enabled') !== 'false');
  const [includeSender, setIncludeSender] = useState(localStorage.getItem('yape_sound_sender') === 'true');
  const [soundVolume, setSoundVolume] = useState(parseFloat(localStorage.getItem('yape_sound_volume') || '1.0'));
  const [showSoundModal, setShowSoundModal] = useState(false);

  // Desktop Background Notifications & Floating Toast
  const [desktopNotifications, setDesktopNotifications] = useState(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
  );
  const [activeToast, setActiveToast] = useState(null);
  const toastTimeoutRef = useRef(null);

  const socketRef = useRef(null);
  const soundSettingsRef = useRef({ soundEnabled, includeSender, soundVolume });
  const userRef = useRef(currentUser);
  const tenantFilterRef = useRef(superAdminTenantFilter);
  const knownPaymentIdsRef = useRef(new Set());
  const sessionStartedEpochRef = useRef(Math.floor(Date.now() / 1000));

  const isSuperAdmin = currentUser?.rol === 'SUPERADMIN';
  const isDueno = currentUser?.rol === 'DUENO';
  const isCajero = currentUser?.rol === 'CAJERO';

  useEffect(() => {
    userRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    tenantFilterRef.current = superAdminTenantFilter;
  }, [superAdminTenantFilter]);

  useEffect(() => {
    soundSettingsRef.current = { soundEnabled, includeSender, soundVolume };
    localStorage.setItem('yape_sound_enabled', soundEnabled.toString());
    localStorage.setItem('yape_sound_sender', includeSender.toString());
    localStorage.setItem('yape_sound_volume', soundVolume.toString());
  }, [soundEnabled, includeSender, soundVolume]);

  const belongsToActiveView = (pago) => {
    const usr = userRef.current;
    if (!usr) return false;
    if (usr.rol === 'SUPERADMIN') {
      const tf = tenantFilterRef.current;
      if (tf && pago.negocio_id !== tf.id) return false;
      return true;
    }
    return Boolean(usr.negocio_id && pago.negocio_id === usr.negocio_id);
  };

  const handleIncomingPayment = (rawPago) => {
    if (!rawPago || !belongsToActiveView(rawPago)) return;
    if (rawPago.id != null && knownPaymentIdsRef.current.has(rawPago.id)) return;
    if (rawPago.id != null) knownPaymentIdsRef.current.add(rawPago.id);

    const nuevoPago = { ...rawPago };
    if (!nuevoPago.banco) {
      const cod = (nuevoPago.codigo_seguridad || '').toUpperCase();
      const rem = nuevoPago.remitente || '';
      const isBbva =
        cod === 'BBVA' ||
        cod.includes('QR-BBVA') ||
        cod.includes('QR BBVA') ||
        (cod === '' && rem === rem.toUpperCase() && rem.length > 5 && /^[A-ZÁÉÍÓÚÑ\s]+$/.test(rem));
      nuevoPago.banco = isBbva ? 'BBVA' : 'YAPE';
    }

    setPayments((prev) => {
      if (prev.some((p) => p.id === nuevoPago.id)) return prev;
      return [nuevoPago, ...prev];
    });

    const { soundEnabled: isSoundOn, includeSender: withSender, soundVolume: vol } = soundSettingsRef.current;
    if (isSoundOn) {
      speakPayment({
        monto: nuevoPago.monto,
        remitente: nuevoPago.remitente,
        banco: nuevoPago.banco || 'YAPE',
        soundEnabled: true,
        includeSender: withSender,
        volume: vol
      });
    }

    showDesktopNotification({
      monto: nuevoPago.monto,
      remitente: nuevoPago.remitente,
      codigo_seguridad: nuevoPago.codigo_seguridad,
      banco: nuevoPago.banco || 'YAPE'
    });

    updateFloatingWidget(nuevoPago);

    setActiveToast(nuevoPago);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setActiveToast(null);
    }, 8000);
  };

  useEffect(() => {
    if (!token) return;
    knownPaymentIdsRef.current = new Set();
    fetchPayments();

    let cleanupRealtime = null;
    if (isSupabaseConfigured && supabase) {
      cleanupRealtime = setupSupabaseRealtime();
    } else {
      setupWebSocket();
    }

    return () => {
      if (cleanupRealtime) cleanupRealtime();
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [token, superAdminTenantFilter]);

  // SEC-01: Sincronización autenticada por JWT en segundo plano.
  // Garantiza alertas de voz, PiP y bloqueo inmediato por suspensión incluso con RLS estricto activado en Supabase.
  useEffect(() => {
    if (!token) return;
    if (startDate || endDate || statusFilter !== '' || searchTerm) return;

    const syncInterval = setInterval(async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && !soundSettingsRef.current.soundEnabled) {
        return;
      }
      try {
        const qp = new URLSearchParams();
        if (isSuperAdmin && superAdminTenantFilter) {
          qp.append('negocio_id', superAdminTenantFilter.id);
        }
        const res = await fetch(`${API_URL}/api/pagos?${qp.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.status === 401 || res.status === 403) {
          handleLogout(data?.error || 'Tu sesión o suscripción ha expirado.');
          return;
        }
        if (!res.ok || !Array.isArray(data)) return;

        // Detectar pagos recién llegados que aún no han sido anunciados
        const unseen = data
          .filter((p) => p.id != null && !knownPaymentIdsRef.current.has(p.id))
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        for (const p of unseen) {
          if ((p.timestamp || 0) >= sessionStartedEpochRef.current - 60) {
            handleIncomingPayment(p);
          } else {
            knownPaymentIdsRef.current.add(p.id);
          }
        }

        // Sincronizar validaciones hechas por otros cajeros/dispositivos sin parpadeo
        const byId = new Map(data.map((p) => [p.id, p]));
        setPayments((prev) => {
          let changed = false;
          const updated = prev.map((oldP) => {
            const fresh = byId.get(oldP.id);
            if (fresh && (fresh.validado !== oldP.validado || fresh.usuario_validador !== oldP.usuario_validador)) {
              changed = true;
              return { ...oldP, ...fresh };
            }
            return oldP;
          });
          return changed ? updated : prev;
        });
      } catch {
        // Silencioso ante microcortes de red
      }
    }, 3500);

    return () => clearInterval(syncInterval);
  }, [token, isSuperAdmin, superAdminTenantFilter, startDate, endDate, statusFilter, searchTerm]);

  useEffect(() => {
    calculateStats();
  }, [payments]);

  const setupSupabaseRealtime = () => {
    const channelConfig = { event: '*', schema: 'public', table: 'pagos' };
    if (currentUser?.rol !== 'SUPERADMIN' && currentUser?.negocio_id) {
      channelConfig.filter = `negocio_id=eq.${currentUser.negocio_id}`;
    }

    const channel = supabase
      .channel(`pagos-tenant-${currentUser?.negocio_id || 'master'}`)
      .on('postgres_changes', { ...channelConfig, event: 'INSERT' }, (payload) => {
        handleIncomingPayment(payload.new);
      })
      .on('postgres_changes', { ...channelConfig, event: 'UPDATE' }, (payload) => {
        const pagoActualizado = payload.new;
        if (!belongsToActiveView(pagoActualizado)) return;
        setPayments((prev) =>
          prev.map((p) => (p.id === pagoActualizado.id ? { ...p, ...pagoActualizado } : p))
        );
      })
      .on('postgres_changes', { ...channelConfig, event: 'DELETE' }, (payload) => {
        if (payload.old && payload.old.id) {
          setPayments((prev) => prev.filter((p) => p.id !== payload.old.id));
        } else {
          fetchPayments();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const setupWebSocket = () => {
    const socketHost = import.meta.env.VITE_API_URL || window.location.origin;
    socketRef.current = io(socketHost, {
      auth: { token }
    });

    socketRef.current.on('nuevo_pago', (nuevoPago) => {
      handleIncomingPayment(nuevoPago);
    });

    socketRef.current.on('pago_validado', (pagoActualizado) => {
      if (!belongsToActiveView(pagoActualizado)) return;
      setPayments((prev) =>
        prev.map((p) => (p.id === pagoActualizado.id ? pagoActualizado : p))
      );
    });

    socketRef.current.on('pago_eliminado', ({ id }) => {
      setPayments((prev) => prev.filter((p) => Number(p.id) !== Number(id)));
    });

    socketRef.current.on('pagos_limpiados', () => {
      fetchPayments();
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
        const profile = data.user || {
          username,
          nombre: username,
          rol: 'SUPERADMIN',
          nombre_comercial: 'Panel Principal'
        };
        localStorage.setItem('yape_token', data.token);
        localStorage.setItem('yape_user', JSON.stringify(profile));
        knownPaymentIdsRef.current = new Set();
        sessionStartedEpochRef.current = Math.floor(Date.now() / 1000);
        setCurrentUser(profile);
        setToken(data.token);
        setActiveTab(profile.rol === 'SUPERADMIN' ? 'clientes' : 'pagos');
      } else {
        setLoginError(data.error || 'Credenciales inválidas');
      }
    } catch {
      setLoginError('Error de conexión con el servidor backend');
    }
  };

  const handleLogout = (reasonMsg = '') => {
    localStorage.removeItem('yape_token');
    localStorage.removeItem('yape_user');
    knownPaymentIdsRef.current = new Set();
    setToken('');
    setCurrentUser(null);
    setPayments([]);
    setSuperAdminTenantFilter(null);
    if (reasonMsg && typeof reasonMsg === 'string') {
      setLoginError(reasonMsg);
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
  };

  const fetchPayments = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (startDate && !isCajero) queryParams.append('fecha_inicio', startDate);
      if (endDate && !isCajero) queryParams.append('fecha_fin', endDate);
      if (statusFilter !== '') queryParams.append('validado', statusFilter);
      if (bankFilter !== '') queryParams.append('banco', bankFilter);
      if (searchTerm) queryParams.append('search', searchTerm);
      if (isSuperAdmin && superAdminTenantFilter) {
        queryParams.append('negocio_id', superAdminTenantFilter.id);
      }

      const res = await fetch(`${API_URL}/api/pagos?${queryParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = await res.json();
      if (res.status === 401 || res.status === 403) {
        handleLogout(data?.error || 'Tu sesión o suscripción ha expirado.');
        return;
      }

      if (res.ok && Array.isArray(data)) {
        data.forEach((p) => {
          if (p.id != null) knownPaymentIdsRef.current.add(p.id);
        });
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
      const res = await fetch(`${API_URL}/api/pagos?id=${id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (res.status === 401 || res.status === 403) {
        handleLogout(data?.error || 'Sesión expirada');
        return;
      }
      if (res.ok && data.pago) {
        setPayments((prev) => prev.map((p) => (p.id === id ? data.pago : p)));
      }
    } catch (err) {
      console.error('Error al validar pago:', err);
    }
  };

  const calculateStats = () => {
    const hoy = new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima' });
    const pagosDeHoy = payments.filter((p) => {
      const fechaPago = new Date(p.timestamp * 1000).toLocaleDateString('es-PE', {
        timeZone: 'America/Lima'
      });
      return fechaPago === hoy;
    });

    let total = 0;
    let pending = 0;
    let validated = 0;

    pagosDeHoy.forEach((p) => {
      total += Number(p.monto || 0);
      if (p.validado === 1) validated++;
      else pending++;
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
    if (viewport.isMobile) setMobileFiltersOpen(false);
  };

  const handleClearFilters = () => {
    setStartDate('');
    setEndDate('');
    setStatusFilter('');
    setBankFilter('');
    setSearchTerm('');
    setQuickCodeSearch('');
    setTimeout(() => fetchPayments(), 50);
  };

  const clearAllPayments = async () => {
    if (isCajero) return;
    if (
      !window.confirm(
        '¿Estás seguro de eliminar permanentemente el historial de pagos mostrado? Esta acción no se puede deshacer.'
      )
    ) {
      return;
    }

    setLoading(true);
    try {
      const extra =
        isSuperAdmin && superAdminTenantFilter
          ? `?negocio_id=${superAdminTenantFilter.id}`
          : '';
      const res = await fetch(`${API_URL}/api/pagos${extra}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      if (res.ok) {
        setPayments([]);
      } else {
        alert(data.error || 'No se pudo limpiar el historial.');
      }
    } catch {
      alert('Error de red al limpiar el historial.');
    } finally {
      setLoading(false);
    }
  };

  const deleteSinglePayment = async (id, e) => {
    if (e) e.stopPropagation();
    if (isCajero) return;
    if (!window.confirm('¿Deseas eliminar este registro de pago definitivamente?')) return;

    try {
      const res = await fetch(`${API_URL}/api/pagos?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setPayments((prev) => prev.filter((p) => p.id !== id));
      } else {
        alert(data.error || 'No se pudo eliminar el pago.');
      }
    } catch (err) {
      console.error('Error al eliminar pago:', err);
    }
  };

  const exportToCsv = () => {
    if (payments.length === 0) return;
    const headers = ['ID', 'Banco', 'Remitente', 'Monto_Soles', 'Fecha_Hora', 'Codigo_Seguridad', 'Estado', 'Validado_Por'];
    const rows = payments.map((p) => [
      p.id,
      p.banco || 'YAPE',
      `"${(p.remitente || '').replace(/"/g, '""')}"`,
      Number(p.monto || 0).toFixed(2),
      `"${formatFecha(p.timestamp)}"`,
      `"${p.codigo_seguridad || ''}"`,
      p.validado === 1 ? 'VALIDADO' : 'PENDIENTE',
      `"${p.usuario_validador || ''}"`
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte_pagos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shareOnWhatsApp = (pago) => {
    const phone = (currentUser?.whatsapp_alerta || '').replace(/[^0-9]/g, '');
    const texto = `✅ *PAGO CONFIRMADO (${pago.banco || 'YAPE'})*\n• Monto: *S/ ${Number(pago.monto).toFixed(2)}*\n• Cliente: ${pago.remitente}\n• Cód. Seguridad: ${pago.codigo_seguridad || '-'}\n• Hora: ${formatFecha(pago.timestamp)}`;
    const waUrl = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(texto)}`
      : `https://wa.me/?text=${encodeURIComponent(texto)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  const getSubscriptionRemainingDays = () => {
    if (!currentUser?.fecha_vencimiento) return null;
    return Math.ceil((new Date(currentUser.fecha_vencimiento).getTime() - Date.now()) / 86400000);
  };

  const remainingDays = getSubscriptionRemainingDays();

  // =========================================================================
  // PANTALLA DE LOGIN ADAPTABLE (PC, TABLET Y CELULAR)
  // =========================================================================
  if (!token) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-tr from-yape-dark via-yape to-yape-light p-4">
        <div className="bg-white/95 backdrop-blur-md p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-md border border-white/20">
          <div className="text-center mb-6 sm:mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-yape/10 text-yape mb-3 shadow-inner">
              <Coins className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900">
              Verificador Yape / Plin / BBVA
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              Plataforma Antifraude en Tiempo Real para Negocios
            </p>
            <span className="inline-block mt-2 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-purple-50 text-yape border border-purple-200">
              Vista optimizada: {viewport.deviceLabel}
            </span>
          </div>

          {loginError && (
            <div className="bg-red-50 text-red-700 p-3.5 rounded-xl text-xs sm:text-sm mb-4 flex items-start gap-2 border border-red-200 font-medium">
              <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-600" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                Usuario (Dueño o Cajero)
              </label>
              <input
                type="text"
                required
                autoCapitalize="none"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-yape focus:border-transparent outline-none transition"
                placeholder="Ej: polleria_admin o polleria_caja"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                Contraseña
              </label>
              <input
                type="password"
                required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-yape focus:border-transparent outline-none transition"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="w-full bg-yape hover:bg-yape-dark active:scale-[0.99] text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-200 flex items-center justify-center"
            >
              Ingresar al Panel
            </button>
          </form>

          {!pwa.isStandalone && (
            <div className="mt-5 pt-4 border-t border-gray-100 text-center">
              <button
                type="button"
                onClick={() => pwa.triggerInstall()}
                className="w-full py-2.5 px-4 rounded-xl border border-purple-200 bg-purple-50/70 hover:bg-purple-100/80 text-yape text-xs font-extrabold transition flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Instalar como App en PC / Celular (Opcional)</span>
              </button>
            </div>
          )}
        </div>

        <PwaInstallModal
          open={pwa.showGuideModal}
          onClose={() => pwa.setShowGuideModal(false)}
          platform={pwa.platform}
          canPromptNative={pwa.canPromptNative}
          onTriggerNativeInstall={pwa.triggerInstall}
        />
      </div>
    );
  }

  const filteredPayments = payments.filter((p) => {
    if (bankFilter && (p.banco || 'YAPE').toUpperCase() !== bankFilter.toUpperCase()) return false;
    if (statusFilter !== '' && p.validado !== parseInt(statusFilter)) return false;
    if (quickCodeSearch.trim()) {
      const codeTerm = quickCodeSearch.trim().toLowerCase();
      const matchCode = (p.codigo_seguridad || '').toLowerCase().includes(codeTerm);
      const matchAmount = Number(p.monto || 0).toFixed(2).includes(codeTerm);
      if (!matchCode && !matchAmount) return false;
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchRem = (p.remitente || '').toLowerCase().includes(term);
      const matchMonto = (p.monto || '').toString().includes(term);
      const matchBank = (p.banco || 'YAPE').toLowerCase().includes(term);
      const matchCod = (p.codigo_seguridad || '').toLowerCase().includes(term);
      if (!matchRem && !matchMonto && !matchBank && !matchCod) return false;
    }
    return true;
  });

  const renderBankBadge = (bancoRaw) => {
    const b = (bancoRaw || 'YAPE').toUpperCase();
    if (b === 'BBVA') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-black tracking-wider bg-[#004481] text-white shadow-sm">
          <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
          BBVA
        </span>
      );
    }
    if (b === 'PLIN') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-black tracking-wider bg-teal-600 text-white shadow-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-300"></span>
          PLIN
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-black tracking-wider bg-[#740099] text-white shadow-sm">
        <span className="w-2 h-2 rounded-full bg-green-400"></span>
        YAPE
      </span>
    );
  };

  return (
    <div className={`min-h-[100dvh] bg-gray-100 ${viewport.isMobile ? 'pb-24' : 'pb-12'}`}>
      {/* NAVBAR SUPERIOR INTELIGENTE */}
      <nav className="bg-yape text-white shadow-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Coins className="w-5 h-5 sm:w-6 sm:h-6 text-white flex-shrink-0" />
              <div className="truncate">
                <span className="font-extrabold text-sm sm:text-lg tracking-wide truncate block">
                  {currentUser?.nombre_comercial || 'YAPE MONITOR'}
                </span>
              </div>
              <span
                className={`hidden sm:inline text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full border flex-shrink-0 ${
                  isSuperAdmin
                    ? 'bg-amber-400 text-gray-900 border-amber-300'
                    : isCajero
                    ? 'bg-emerald-500 text-white border-emerald-300'
                    : 'bg-yape-dark text-white border-white/20'
                }`}
              >
                {currentUser?.rol || 'ADMIN'}
              </span>
              {/* Indicador automático de tipo de monitor detectado */}
              <span
                className="hidden xl:inline-flex items-center gap-1 text-[10px] font-semibold bg-white/15 text-white/95 px-2 py-0.5 rounded-full border border-white/20 flex-shrink-0"
                title={`Resolución detectada: ${viewport.resolutionText}`}
              >
                <Smartphone className="w-3 h-3" />
                {viewport.deviceLabel}
              </span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              {/* Pestañas SuperAdmin en Tablet / PC */}
              {isSuperAdmin && !viewport.isMobile && (
                <div className="flex items-center bg-yape-dark/80 p-1 rounded-xl border border-white/15 mr-1">
                  <button
                    onClick={() => setActiveTab('clientes')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                      activeTab === 'clientes'
                        ? 'bg-white text-yape shadow-sm'
                        : 'text-white/80 hover:text-white'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>Clientes SaaS</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('pagos')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                      activeTab === 'pagos'
                        ? 'bg-white text-yape shadow-sm'
                        : 'text-white/80 hover:text-white'
                    }`}
                  >
                    <Coins className="w-3.5 h-3.5" />
                    <span>Pagos en Vivo</span>
                  </button>
                </div>
              )}

              {/* Botón Mi Negocio en Tablet / PC */}
              {isDueno && !viewport.isMobile && (
                <button
                  onClick={() => setShowTenantModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition border shadow-sm bg-white text-yape hover:bg-purple-50 border-white"
                  title="Configurar Cajeros, API Key, Webhook y WhatsApp"
                >
                  <Users className="w-4 h-4" />
                  <span className="hidden md:inline">Mi Negocio / Cajeros</span>
                </button>
              )}

              {/* Parlante On/Off */}
              <button
                onClick={() => {
                  const newState = !soundEnabled;
                  setSoundEnabled(newState);
                  if (newState) playChime(soundVolume);
                }}
                className={`flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold transition border shadow-sm ${
                  soundEnabled
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-400'
                    : 'bg-red-500/90 hover:bg-red-600 text-white border-red-400'
                }`}
                title={soundEnabled ? 'Parlante Activado' : 'Parlante Silenciado'}
              >
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                <span className="hidden lg:inline">{soundEnabled ? 'Voz: ON' : 'Voz: OFF'}</span>
              </button>

              {/* Alertas Escritorio (Tablet / PC) */}
              {!viewport.isMobile && (
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
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition border shadow-sm ${
                    desktopNotifications
                      ? 'bg-purple-900/60 hover:bg-purple-900 text-white border-purple-400'
                      : 'bg-amber-500/90 hover:bg-amber-600 text-white border-amber-300'
                  }`}
                  title="Activar alertas emergentes de escritorio"
                >
                  {desktopNotifications ? <BellRing className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                </button>
              )}

              {/* Mini-Ventana Flotante PiP (Solo en PC donde es soportado) */}
              {viewport.isPC && isPipSupported() && (
                <button
                  onClick={async () => {
                    await openYapeFloatingWidget({
                      onValidatePayment: (id) => validatePayment(id)
                    });
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition border shadow-sm bg-blue-600 hover:bg-blue-700 text-white border-blue-400"
                  title="Abrir Mini-Ventana Flotante SIEMPRE VISIBLE en PC"
                >
                  <AppWindow className="w-4 h-4" />
                  <span className="hidden xl:inline">Flotante</span>
                </button>
              )}

              {/* Botón Opcional Instalar PWA (Oculto automáticamente si ya está instalada) */}
              {!pwa.isStandalone && (
                <button
                  onClick={() => pwa.triggerInstall()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition border shadow-sm bg-white/15 hover:bg-white/25 text-white border-white/30"
                  title="Instalar Aplicación Web en este dispositivo (Opcional)"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden md:inline">Instalar App</span>
                </button>
              )}

              <button
                onClick={() => setShowSoundModal(true)}
                className="p-2 rounded-full hover:bg-white/10 transition text-white"
                title="Configuración de Voz y App"
              >
                <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {activeTab === 'pagos' && !viewport.isMobile && (
                <>
                  <button
                    onClick={fetchPayments}
                    disabled={loading}
                    className="p-2 rounded-full hover:bg-white/10 transition text-white"
                    title="Actualizar Pagos"
                  >
                    <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                  </button>

                  {!isCajero && (
                    <button
                      onClick={clearAllPayments}
                      className="p-2 rounded-full hover:bg-red-500/30 transition text-white"
                      title="Limpiar Historial"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </>
              )}

              <button
                onClick={() => handleLogout()}
                className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-yape-dark hover:bg-red-700 transition text-xs font-semibold text-white"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Salir</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Alerta de vencimiento próximo */}
      {!isSuperAdmin && remainingDays !== null && remainingDays <= 5 && (
        <div className="bg-amber-500 text-white text-xs sm:text-sm font-bold py-2 px-4 text-center shadow">
          ⚠️ Tu suscripción ({currentUser?.plan}) vence en {Math.max(0, remainingDays)} día(s). Contacta a soporte para renovar.
        </div>
      )}

      {/* CUERPO PRINCIPAL ADAPTABLE */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 mt-4 sm:mt-6">
        {isSuperAdmin && activeTab === 'clientes' ? (
          <SuperAdminPanel
            token={token}
            apiUrl={API_URL}
            onSelectTenantFilter={(neg) => {
              setSuperAdminTenantFilter(neg);
              setActiveTab('pagos');
            }}
          />
        ) : (
          <>
            {isSuperAdmin && superAdminTenantFilter && (
              <div className="mb-4 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs sm:text-sm text-purple-950 font-semibold">
                  Inspeccionando pagos de:{' '}
                  <strong className="font-extrabold">{superAdminTenantFilter.nombre_comercial}</strong>
                </div>
                <button
                  onClick={() => setSuperAdminTenantFilter(null)}
                  className="text-xs font-bold bg-white hover:bg-purple-100 text-yape px-3 py-1.5 rounded-lg border border-purple-200"
                >
                  Ver Todos los Pagos
                </button>
              </div>
            )}

            {/* Barra Especial MODO CAJERO ANTIFRAUDE */}
            {isCajero && (
              <div className="mb-4 sm:mb-6 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-4 sm:p-5 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] sm:text-[11px] uppercase font-extrabold bg-white/20 px-2.5 py-0.5 rounded-full">
                    Modo Cajero Antifraude • Turno del Día
                  </span>
                  <h2 className="text-base sm:text-xl font-black mt-1">
                    Verifica el Código de 3 Dígitos antes de entregar el pedido
                  </h2>
                </div>
                <div className="w-full md:w-72">
                  <input
                    type="text"
                    placeholder="Escribe cód. 3 dígitos o monto..."
                    className="w-full px-4 py-2.5 rounded-xl text-gray-900 font-extrabold text-sm outline-none shadow-inner"
                    value={quickCodeSearch}
                    onChange={(e) => setQuickCodeSearch(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Tarjetas de Resumen del Día (Compactas en celular, amplias en PC) */}
            <div className="grid grid-cols-3 gap-2.5 sm:gap-4 mb-4 sm:mb-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-5 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase truncate">
                    Hoy (S/)
                  </p>
                  <h3 className="text-base sm:text-3xl font-black text-gray-800 mt-0.5 truncate">
                    S/ {stats.totalToday.toFixed(2)}
                  </h3>
                </div>
                <div className="hidden sm:flex w-11 h-11 rounded-full bg-green-50 text-green-600 items-center justify-center flex-shrink-0">
                  <Coins className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-5 flex items-center justify-between">
                <div>
                  <p className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase">Validados</p>
                  <h3 className="text-lg sm:text-3xl font-black text-green-600 mt-0.5">
                    {stats.validatedCount}
                  </h3>
                </div>
                <div className="hidden sm:flex w-11 h-11 rounded-full bg-green-50 text-green-600 items-center justify-center flex-shrink-0">
                  <CheckCircle className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-5 flex items-center justify-between">
                <div>
                  <p className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase">Pendientes</p>
                  <h3 className="text-lg sm:text-3xl font-black text-yellow-600 mt-0.5">
                    {stats.pendingCount}
                  </h3>
                </div>
                <div className="hidden sm:flex w-11 h-11 rounded-full bg-yellow-50 text-yellow-600 items-center justify-center flex-shrink-0">
                  <Clock className="w-6 h-6" />
                </div>
              </div>
            </div>

            {/* Panel de Filtros (Colapsable en Celular para no ocupar toda la pantalla) */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3.5 sm:p-5 mb-4 sm:mb-6">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1">
                  {viewport.isMobile ? (
                    <div className="relative flex-1">
                      <input
                        type="text"
                        placeholder="Buscar cliente, cód 3 dígitos o monto..."
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-1 focus:ring-yape outline-none"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-gray-700">
                      <Filter className="w-5 h-5" />
                      <h2 className="font-bold text-base">Filtros y Búsqueda</h2>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {viewport.isMobile && (
                    <button
                      type="button"
                      onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
                      className="px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-700 flex items-center gap-1"
                    >
                      <Filter className="w-3.5 h-3.5" />
                      <span>{mobileFiltersOpen ? 'Ocultar' : 'Filtros'}</span>
                    </button>
                  )}

                  {!isCajero && payments.length > 0 && (
                    <button
                      type="button"
                      onClick={exportToCsv}
                      className="text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-2 sm:py-1.5 rounded-xl sm:rounded-lg transition"
                    >
                      ⬇ CSV
                    </button>
                  )}
                </div>
              </div>

              {(!viewport.isMobile || mobileFiltersOpen) && (
                <form
                  onSubmit={handleApplyFilters}
                  className={`grid grid-cols-1 sm:grid-cols-2 ${
                    isCajero ? 'lg:grid-cols-4' : 'lg:grid-cols-6'
                  } gap-3 sm:gap-4 items-end mt-3 pt-3 border-t border-gray-100`}
                >
                  {!viewport.isMobile && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                        Buscar
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Cliente, cód, monto..."
                          className="w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-yape outline-none"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                      Billetera / Banco
                    </label>
                    <select
                      className="w-full px-3 py-2 sm:py-1.5 border border-gray-300 rounded-lg text-sm bg-white font-medium outline-none"
                      value={bankFilter}
                      onChange={(e) => setBankFilter(e.target.value)}
                    >
                      <option value="">Todos (Yape, Plin, BBVA)</option>
                      <option value="YAPE">Solo Yape</option>
                      <option value="PLIN">Solo Plin</option>
                      <option value="BBVA">Solo BBVA</option>
                    </select>
                  </div>

                  {!isCajero && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                          Desde Fecha
                        </label>
                        <input
                          type="date"
                          className="w-full px-3 py-2 sm:py-1.5 border border-gray-300 rounded-lg text-sm outline-none"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                          Hasta Fecha
                        </label>
                        <input
                          type="date"
                          className="w-full px-3 py-2 sm:py-1.5 border border-gray-300 rounded-lg text-sm outline-none"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                      Estado
                    </label>
                    <select
                      className="w-full px-3 py-2 sm:py-1.5 border border-gray-300 rounded-lg text-sm bg-white outline-none"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="">Todos los estados</option>
                      <option value="0">Pendientes</option>
                      <option value="1">Validados</option>
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="flex-1 bg-yape hover:bg-yape-dark text-white font-bold py-2 sm:py-1.5 px-4 rounded-lg text-sm shadow-sm transition"
                    >
                      Filtrar
                    </button>
                    <button
                      type="button"
                      onClick={handleClearFilters}
                      className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-2 sm:py-1.5 px-4 rounded-lg text-sm transition"
                    >
                      Limpiar
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* LISTA DE PAGOS ADAPTATIVA: TARJETAS TÁCTILES EN CELULAR/TABLET vs TABLA EN PC */}
            {loading && payments.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-400">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-yape" />
                Cargando registros...
              </div>
            ) : filteredPayments.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-sm text-gray-400">
                No se encontraron pagos con los filtros seleccionados
              </div>
            ) : viewport.useCardLayout ? (
              /* MODO CELULAR Y TABLET: Tarjetas Táctiles de Pagos */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredPayments.map((p) => {
                  const isBbva = (p.banco || '').toUpperCase() === 'BBVA';
                  return (
                    <div
                      key={p.id}
                      className={`bg-white rounded-2xl border p-4 shadow-sm transition ${
                        p.validado === 0
                          ? isBbva
                            ? 'border-blue-300 bg-blue-50/10'
                            : 'border-purple-300 bg-yellow-50/10'
                          : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            {renderBankBadge(p.banco)}
                            {p.codigo_seguridad && (
                              <span className="font-mono font-extrabold text-xs bg-purple-50 text-yape border border-purple-200 px-2 py-0.5 rounded-md">
                                Cód: {p.codigo_seguridad}
                              </span>
                            )}
                          </div>
                          <h4 className="font-extrabold text-gray-900 text-base leading-snug">
                            {p.remitente}
                          </h4>
                          <p className="text-xs text-gray-400">{formatFecha(p.timestamp)}</p>
                        </div>

                        <div className="text-right flex-shrink-0">
                          <div className="flex items-center justify-end gap-1">
                            <span
                              className={`text-xl font-black ${
                                isBbva ? 'text-[#004481]' : 'text-yape'
                              }`}
                            >
                              S/ {Number(p.monto || 0).toFixed(2)}
                            </span>
                            <button
                              onClick={() =>
                                speakPayment({
                                  monto: p.monto,
                                  remitente: p.remitente,
                                  banco: p.banco || 'YAPE',
                                  soundEnabled: true,
                                  includeSender,
                                  volume: soundVolume
                                })
                              }
                              className="p-1.5 rounded-lg bg-gray-100 text-gray-600 active:bg-purple-100"
                              title="Escuchar voz"
                            >
                              <Volume2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="mt-1">
                            {p.validado === 1 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-800">
                                <Check className="w-3 h-3" /> Validado ({formatFechaValidacion(p.fecha_validacion)})
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-yellow-100 text-yellow-800">
                                <Clock className="w-3 h-3" /> Pendiente
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center gap-2">
                        {p.validado === 0 ? (
                          <button
                            onClick={() => validatePayment(p.id)}
                            className="flex-1 bg-emerald-600 active:bg-emerald-700 text-white font-bold py-2.5 px-3 rounded-xl text-xs shadow-sm flex items-center justify-center gap-1"
                          >
                            <Check className="w-4 h-4" />
                            <span>Validar Pedido</span>
                          </button>
                        ) : (
                          <span className="flex-1 text-xs text-gray-400 font-medium">
                            Atendido por: {p.usuario_validador || 'caja'}
                          </span>
                        )}

                        <button
                          onClick={() => shareOnWhatsApp(p)}
                          className="bg-emerald-50 active:bg-emerald-100 text-emerald-700 font-bold text-xs py-2.5 px-3 rounded-xl border border-emerald-200 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>WhatsApp</span>
                        </button>

                        {!isCajero && (
                          <button
                            onClick={(e) => deleteSinglePayment(p.id, e)}
                            className="p-2.5 rounded-xl text-gray-400 hover:text-red-600 bg-gray-50"
                            title="Eliminar pago"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* MODO PC: Tabla Completa de Escritorio */
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                        <th className="px-5 py-3.5">Canal</th>
                        <th className="px-5 py-3.5">Remitente</th>
                        <th className="px-5 py-3.5">Monto</th>
                        <th className="px-5 py-3.5">Fecha y Hora</th>
                        <th className="px-5 py-3.5">Cód. Seguridad</th>
                        <th className="px-5 py-3.5">Estado</th>
                        <th className="px-5 py-3.5 text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                      {filteredPayments.map((p) => {
                        const isBbva = (p.banco || '').toUpperCase() === 'BBVA';
                        return (
                          <tr
                            key={p.id}
                            className={`hover:bg-gray-50 transition duration-150 ${
                              p.validado === 0 ? (isBbva ? 'bg-blue-50/20' : 'bg-yellow-50/20') : ''
                            }`}
                          >
                            <td className="px-5 py-3.5">{renderBankBadge(p.banco)}</td>
                            <td className="px-5 py-3.5 font-semibold text-gray-900">{p.remitente}</td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`font-extrabold text-base ${
                                    isBbva ? 'text-[#004481]' : 'text-yape'
                                  }`}
                                >
                                  S/ {Number(p.monto || 0).toFixed(2)}
                                </span>
                                <button
                                  onClick={() =>
                                    speakPayment({
                                      monto: p.monto,
                                      remitente: p.remitente,
                                      banco: p.banco || 'YAPE',
                                      soundEnabled: true,
                                      includeSender,
                                      volume: soundVolume
                                    })
                                  }
                                  className="p-1 rounded text-gray-400 hover:text-yape hover:bg-yape/10 transition"
                                  title="Repetir anuncio en el parlante"
                                >
                                  <Volume2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-gray-500">{formatFecha(p.timestamp)}</td>
                            <td className="px-5 py-3.5">
                              {p.codigo_seguridad ? (
                                <span className="inline-block font-mono font-extrabold text-sm bg-purple-50 text-yape border border-purple-200 px-2.5 py-0.5 rounded-md">
                                  {p.codigo_seguridad}
                                </span>
                              ) : (
                                <span className="text-gray-400">{isBbva ? 'QR BBVA' : '-'}</span>
                              )}
                            </td>
                            <td className="px-5 py-3.5">
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
                            <td className="px-5 py-3.5 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {p.validado === 0 ? (
                                  <button
                                    onClick={() => validatePayment(p.id)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition"
                                  >
                                    ✔ Validar
                                  </button>
                                ) : (
                                  <span className="text-xs text-gray-400 font-medium">
                                    Por: {p.usuario_validador || 'caja'}
                                  </span>
                                )}

                                <button
                                  onClick={() => shareOnWhatsApp(p)}
                                  className="text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-lg border border-emerald-200 transition flex items-center gap-1"
                                  title="Enviar comprobante verificado por WhatsApp"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  <span className="hidden xl:inline">WhatsApp</span>
                                </button>

                                {!isCajero && (
                                  <button
                                    onClick={(e) => deleteSinglePayment(p.id, e)}
                                    className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 transition"
                                    title="Eliminar pago"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
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
          </>
        )}
      </main>

      {/* BARRA DE NAVEGACIÓN INFERIOR TIPO APP NATIVA (EXCLUSIVA PARA CELULAR) */}
      {viewport.isMobile && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] pb-safe">
          <div className="grid grid-cols-4 h-16">
            {isSuperAdmin ? (
              <>
                <button
                  onClick={() => setActiveTab('clientes')}
                  className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold ${
                    activeTab === 'clientes' ? 'text-yape' : 'text-gray-400'
                  }`}
                >
                  <Building2 className="w-5 h-5" />
                  <span>Clientes</span>
                </button>
                <button
                  onClick={() => setActiveTab('pagos')}
                  className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold ${
                    activeTab === 'pagos' ? 'text-yape' : 'text-gray-400'
                  }`}
                >
                  <Coins className="w-5 h-5" />
                  <span>Pagos</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setActiveTab('pagos')}
                  className="flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-yape"
                >
                  <Coins className="w-5 h-5" />
                  <span>Pagos Hoy</span>
                </button>
                {isDueno ? (
                  <button
                    onClick={() => setShowTenantModal(true)}
                    className="flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-gray-500 active:text-yape"
                  >
                    <Users className="w-5 h-5" />
                    <span>Mi Negocio</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setShowSoundModal(true)}
                    className="flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-gray-500 active:text-yape"
                  >
                    <Settings className="w-5 h-5" />
                    <span>Ajustes Voz</span>
                  </button>
                )}
              </>
            )}

            <button
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                if (next) playChime(soundVolume);
              }}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold ${
                soundEnabled ? 'text-emerald-600' : 'text-red-500'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              <span>{soundEnabled ? 'Voz ON' : 'Mudo'}</span>
            </button>

            <button
              onClick={fetchPayments}
              className="flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-gray-500 active:text-yape"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-yape' : ''}`} />
              <span>Actualizar</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal Configuración Mi Negocio (Dueño) */}
      {showTenantModal && (
        <TenantSettingsModal
          token={token}
          apiUrl={API_URL}
          user={currentUser}
          onClose={() => setShowTenantModal(false)}
          onProfileUpdated={(updates) => {
            const nextUser = { ...currentUser, ...updates };
            setCurrentUser(nextUser);
            localStorage.setItem('yape_user', JSON.stringify(nextUser));
          }}
        />
      )}

      {/* Modal Configuración del Parlante (Cabecera fija + scroll seguro) */}
      {showSoundModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-md w-full border border-gray-100 max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-yape/10 text-yape flex items-center justify-center">
                  <Volume2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-800">Configuración del Parlante</h3>
                  <p className="text-[11px] text-gray-500">Modo: {viewport.deviceLabel}</p>
                </div>
              </div>
              <button
                onClick={() => setShowSoundModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto modal-scroll flex-1 space-y-3.5 text-sm text-gray-700 pb-safe">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div>
                  <span className="font-semibold block">Voz en Parlante</span>
                  <span className="text-xs text-gray-500">Cantar el monto apenas ingrese el pago</span>
                </div>
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => setSoundEnabled(e.target.checked)}
                  className="w-5 h-5 accent-yape cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div>
                  <span className="font-semibold block">Mencionar Nombre del Cliente</span>
                  <span className="text-xs text-gray-500">Ej: "¡Yape! 50 soles de Juan Perez"</span>
                </div>
                <input
                  type="checkbox"
                  checked={includeSender}
                  onChange={(e) => setIncludeSender(e.target.checked)}
                  className="w-5 h-5 accent-yape cursor-pointer"
                />
              </div>

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

              <button
                type="button"
                onClick={() => {
                  speakPayment({
                    monto: 50.0,
                    remitente: includeSender ? 'Juan Pérez' : '',
                    banco: 'YAPE',
                    soundEnabled: true,
                    includeSender,
                    volume: soundVolume
                  });
                  setActiveToast({
                    id: 999,
                    monto: 50.0,
                    remitente: 'Juan Pérez (Prueba Yape)',
                    codigo_seguridad: '482',
                    banco: 'YAPE'
                  });
                }}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-yape to-yape-dark text-white font-bold py-2.5 px-4 rounded-xl shadow-md transition"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Probar Voz Yape (S/ 50.00)</span>
              </button>

              {/* Sección Opcional de Aplicación Web Instalable (PWA) */}
              <div className="p-3.5 bg-purple-50/70 rounded-xl border border-purple-200 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-bold text-gray-900 block text-xs sm:text-sm">
                    Aplicación Instalable (PWA Opcional)
                  </span>
                  <span className="text-[11px] text-gray-600 block">
                    {pwa.isStandalone
                      ? 'Ya estás ejecutando el panel como Aplicación instalada.'
                      : 'Crea un acceso directo tipo App en tu PC, Tablet o Celular.'}
                  </span>
                </div>
                {pwa.isStandalone ? (
                  <span className="text-xs font-extrabold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-lg flex-shrink-0">
                    ✔ Instalada
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setShowSoundModal(false);
                      pwa.triggerInstall();
                    }}
                    className="bg-white hover:bg-purple-100 text-yape border border-purple-300 font-extrabold text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 flex-shrink-0 shadow-sm transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Instalar</span>
                  </button>
                )}
              </div>

              <div className="flex justify-end pt-1">
                <button
                  onClick={() => setShowSoundModal(false)}
                  className="w-full sm:w-auto bg-gray-800 hover:bg-gray-900 text-white text-xs font-bold py-2.5 px-5 rounded-xl transition"
                >
                  Listo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Flotante Adaptativo (Arriba de la barra inferior en Celular, esquina inferior derecha en PC/Tablet) */}
      {activeToast &&
        (() => {
          const isBbvaToast = (activeToast.banco || '').toUpperCase() === 'BBVA';
          return (
            <div
              className={`fixed z-50 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border-2 p-4 ${
                isBbvaToast ? 'border-[#004481]' : 'border-yape'
              } ${
                viewport.isMobile
                  ? 'left-3 right-3 bottom-20'
                  : 'bottom-6 right-6 max-w-sm w-full'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-11 h-11 rounded-xl text-white flex items-center justify-center flex-shrink-0 shadow-md ${
                      isBbvaToast
                        ? 'bg-gradient-to-tr from-[#004481] to-[#00a9e0]'
                        : 'bg-gradient-to-tr from-yape to-yape-light'
                    }`}
                  >
                    <Coins className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-2.5 h-2.5 rounded-full animate-ping ${
                          isBbvaToast ? 'bg-cyan-400' : 'bg-emerald-500'
                        }`}
                      ></span>
                      <span
                        className={`text-xs font-bold uppercase tracking-wider ${
                          isBbvaToast ? 'text-[#004481]' : 'text-yape'
                        }`}
                      >
                        ¡{activeToast.banco || 'YAPE'} Recibido!
                      </span>
                    </div>
                    <h4 className="text-xl sm:text-2xl font-black text-gray-900">
                      S/ {Number(activeToast.monto).toFixed(2)}
                    </h4>
                    <p className="text-xs font-semibold text-gray-600 truncate">
                      {activeToast.remitente || 'Cliente'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setActiveToast(null)}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 flex-shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between">
                <span className="text-[11px] font-bold text-gray-500">
                  {activeToast.codigo_seguridad ? `Cód: ${activeToast.codigo_seguridad}` : 'Ahora mismo'}
                </span>
                <button
                  onClick={() => {
                    validatePayment(activeToast.id);
                    setActiveToast(null);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg transition flex items-center gap-1 shadow-sm"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Validar Pago</span>
                </button>
              </div>
            </div>
          );
        })()}
      <PwaInstallModal
        open={pwa.showGuideModal}
        onClose={() => pwa.setShowGuideModal(false)}
        platform={pwa.platform}
        canPromptNative={pwa.canPromptNative}
        onTriggerNativeInstall={pwa.triggerInstall}
      />
    </div>
  );
}

export default App;
