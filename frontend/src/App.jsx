import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Search, LogOut, CheckCircle, Clock, 
  Coins, Filter, Calendar, RefreshCw, 
  Smartphone, ShieldAlert, Check, Trash2
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

function App() {
  const [token, setToken] = useState(localStorage.getItem('yape_token') || '');
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

  const socketRef = useRef(null);

  // Auto-login verify
  useEffect(() => {
    if (token) {
      fetchPayments();
      // Setup WebSockets
      setupWebSocket();
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

  const setupWebSocket = () => {
    // Intentar conectar con la URL de la API o el origin actual
    const socketHost = import.meta.env.VITE_API_URL || window.location.origin;
    socketRef.current = io(socketHost);

    socketRef.current.on('nuevo_pago', (nuevoPago) => {
      // Prevenir duplicados si llega por websocket y HTTP
      setPayments((prev) => {
        if (prev.some((p) => p.id === nuevoPago.id)) return prev;
        return [nuevoPago, ...prev];
      });
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
      // Construir query string de filtros
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
        // El estado se actualizará automáticamente a través del evento del WebSocket, 
        // pero lo actualizamos localmente también para feedback instantáneo si hay retrasos.
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
            <div className="flex items-center gap-4">
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
                      <td className="px-6 py-4 font-bold text-yape text-base">S/ {p.monto.toFixed(2)}</td>
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
    </div>
  );
}

export default App;
