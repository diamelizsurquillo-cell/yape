import React, { useState, useEffect } from 'react';
import {
  X, Copy, Check, Users, Plus, Trash2, Play, ExternalLink, Smartphone, Save, Eye, EyeOff, KeyRound
} from 'lucide-react';

export default function TenantSettingsModal({ token, apiUrl, user, onClose, onProfileUpdated }) {
  const [negocio, setNegocio] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [userDrafts, setUserDrafts] = useState({});
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [savingUserId, setSavingUserId] = useState(null);
  const [webhookUrl, setWebhookUrl] = useState(user?.webhook_url || '');
  const [whatsappAlerta, setWhatsappAlerta] = useState(user?.whatsapp_alerta || '');
  const [cajeroForm, setCajeroForm] = useState({ username: '', password: '', nombre_mostrar: '' });
  const [copied, setCopied] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [pairingData, setPairingData] = useState(null);
  const [generatingPair, setGeneratingPair] = useState(false);

  useEffect(() => {
    loadMyBusiness();
  }, []);

  const loadMyBusiness = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.negocio) {
        const list = (data.usuarios || []).sort((a, b) => {
          if (a.rol === 'DUENO' && b.rol !== 'DUENO') return -1;
          if (a.rol !== 'DUENO' && b.rol === 'DUENO') return 1;
          return 0;
        });
        const drafts = {};
        list.forEach((u) => {
          drafts[u.id] = {
            username: u.username || '',
            password: u.password || '',
            activo: u.activo !== false
          };
        });
        setNegocio(data.negocio);
        setUsuarios(list);
        setUserDrafts(drafts);
        setWebhookUrl(data.negocio.webhook_url || '');
        setWhatsappAlerta(data.negocio.whatsapp_alerta || '');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const copyVal = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleSaveIntegrations = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiUrl}/api/admin`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'update_settings',
          webhook_url: webhookUrl,
          whatsapp_alerta: whatsappAlerta
        })
      });
      const data = await res.json();
      if (res.ok) {
        setMsg('Integraciones guardadas correctamente.');
        if (onProfileUpdated) {
          onProfileUpdated({
            webhook_url: webhookUrl,
            whatsapp_alerta: whatsappAlerta
          });
        }
        setTimeout(() => setMsg(''), 3000);
      } else {
        alert(data.error || 'No se pudo guardar');
      }
    } catch {
      alert('Error de conexión');
    }
  };

  const handleCreateCajero = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiUrl}/api/admin`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'create_usuario',
          username: cajeroForm.username,
          password: cajeroForm.password,
          nombre_mostrar: cajeroForm.nombre_mostrar || `Cajero ${cajeroForm.username}`,
          rol: 'CAJERO'
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Error al crear cajero');
        return;
      }
      setCajeroForm({ username: '', password: '', nombre_mostrar: '' });
      setMsg('Cajero creado con éxito.');
      loadMyBusiness();
    } catch {
      alert('Error al crear cajero');
    }
  };

  const handleDeleteCajero = async (id) => {
    if (!window.confirm('¿Eliminar este acceso de cajero?')) return;
    const res = await fetch(`${apiUrl}/api/admin?type=usuario&id=${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      setMsg('Cajero eliminado.');
      setTimeout(() => setMsg(''), 3000);
      loadMyBusiness();
    }
  };

  const handleSaveUserCredentials = async (u) => {
    const draft = userDrafts[u.id];
    if (!draft) return;
    const cleanUsername = String(draft.username || '').trim();
    const cleanPassword = String(draft.password || '');

    if (!cleanUsername) {
      alert('El nombre de usuario no puede quedar vacío.');
      return;
    }
    if (cleanPassword.length < 4) {
      alert('La contraseña debe tener al menos 4 caracteres.');
      return;
    }

    setSavingUserId(u.id);
    try {
      const res = await fetch(`${apiUrl}/api/admin`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'update_usuario',
          usuario_id: u.id,
          username: cleanUsername,
          password: cleanPassword,
          activo: u.rol === 'DUENO' ? true : draft.activo
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'No se pudo actualizar el usuario');
        return;
      }

      if (String(u.id) === String(user?.id) && onProfileUpdated) {
        onProfileUpdated({ username: data.usuario?.username || cleanUsername });
      }

      setMsg(
        u.rol === 'DUENO'
          ? '¡Tu usuario y contraseña de DUEÑO se actualizaron correctamente!'
          : `¡Credenciales del cajero "${cleanUsername}" actualizadas!`
      );
      setTimeout(() => setMsg(''), 3500);
      await loadMyBusiness();
    } catch {
      alert('Error de conexión al guardar credenciales');
    } finally {
      setSavingUserId(null);
    }
  };

  const handleTestMySensor = async () => {
    const key = negocio?.api_key || user?.api_key;
    if (!key) return;
    const code = String(Math.floor(100 + Math.random() * 900));
    const res = await fetch(`${apiUrl}/api/pagos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key
      },
      body: JSON.stringify({
        remitente: 'Prueba Mi Negocio',
        monto: 15.5,
        timestamp: Math.floor(Date.now() / 1000),
        codigo_seguridad: code,
        banco: 'YAPE'
      })
    });
    if (res.ok) {
      setMsg(`¡Pago de prueba enviado (S/ 15.50 - Cód ${code})!`);
    }
  };

  const handleGeneratePairCode = async () => {
    setGeneratingPair(true);
    try {
      const res = await fetch(`${apiUrl}/api/pair`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok && data.codigo) {
        setPairingData(data);
      } else {
        alert(data.error || 'No se pudo generar el código de vinculación');
      }
    } catch {
      alert('Error de red al generar código');
    } finally {
      setGeneratingPair(false);
    }
  };

  const activeApiKey = negocio?.api_key || user?.api_key || '';
  const sensorStatus = negocio?.sensor_status;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-3">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 max-h-[93dvh] sm:max-h-[90dvh] flex flex-col overflow-hidden">
        {/* Cabecera fija */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-white">
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-extrabold text-gray-900 truncate">
              Mi Negocio: {negocio?.nombre_comercial || user?.nombre_comercial}
            </h3>
            <p className="text-[11px] sm:text-xs text-gray-500">
              Vincula tu celular Android, administra a tus cajeros y conecta tus integraciones.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cuerpo con scroll interno */}
        <div className="p-4 sm:p-6 overflow-y-auto modal-scroll flex-1 space-y-4 text-sm pb-safe">
          {msg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
              {msg}
            </div>
          )}

          <div className="p-3.5 sm:p-4 bg-purple-50/60 border border-purple-200 rounded-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-extrabold text-yape uppercase flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4" /> 1. Vincular Celular Android (Sensor v2.0)
                </span>
                {sensorStatus?.online ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    En Línea {sensorStatus.device_name ? `(${sensorStatus.device_name})` : ''}
                    {sensorStatus.battery !== null && sensorStatus.battery !== undefined
                      ? ` • ${sensorStatus.battery}%`
                      : ''}
                  </span>
                ) : sensorStatus?.sensor_last_seen ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                    Sin señal reciente {sensorStatus.device_name ? `(${sensorStatus.device_name})` : ''}
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-600">
                    Pendiente de vincular
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleTestMySensor}
                className="bg-yape hover:bg-yape-dark text-white text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1"
              >
                <Play className="w-3 h-3 fill-white" /> Simular Pago S/ 15.50
              </button>
            </div>

            {/* Tarjeta de Vinculación Rápida de 6 Dígitos */}
            <div className="bg-white p-3 rounded-xl border border-purple-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs font-extrabold text-gray-900 block">
                  ⚡ Vinculación Instantánea con Código de 6 Dígitos (Recomendado)
                </span>
                <span className="text-[11px] text-gray-500 block">
                  Abre la App Yape Sensor v2.0 en tu celular, escribe este código y quedará enlazado con firma HMAC sin copiar llaves largas.
                </span>
              </div>
              {pairingData?.codigo ? (
                <div className="flex items-center gap-2 bg-purple-50 border border-purple-300 px-3.5 py-2 rounded-xl flex-shrink-0">
                  <span className="font-mono text-xl font-black tracking-widest text-yape">
                    {pairingData.codigo.slice(0, 3)} {pairingData.codigo.slice(3)}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyVal(pairingData.codigo, 'paircode')}
                    className="text-xs font-bold text-yape bg-white px-2 py-1 rounded border border-purple-200"
                  >
                    {copied === 'paircode' ? '¡Copiado!' : 'Copiar'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={generatingPair}
                  onClick={handleGeneratePairCode}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-3.5 py-2.5 rounded-xl flex-shrink-0 shadow-sm transition"
                >
                  {generatingPair ? 'Generando...' : 'Generar Código 6 Dígitos'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <div className="bg-white p-2.5 rounded-lg border border-gray-200">
                <div className="flex justify-between text-gray-500 font-semibold mb-1">
                  <span>URL del Backend:</span>
                  <button
                    onClick={() => copyVal(window.location.origin, 'url')}
                    className="text-yape font-bold flex items-center gap-1"
                  >
                    {copied === 'url' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied === 'url' ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                <code className="text-gray-800 break-all">{window.location.origin}</code>
              </div>

              <div className="bg-white p-2.5 rounded-lg border border-gray-200">
                <div className="flex justify-between text-gray-500 font-semibold mb-1">
                  <span>Tu API Key Exclusiva:</span>
                  <button
                    onClick={() => copyVal(activeApiKey, 'key')}
                    className="text-yape font-bold flex items-center gap-1"
                  >
                    {copied === 'key' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied === 'key' ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                <code className="text-gray-800 break-all">{activeApiKey}</code>
              </div>
            </div>
          </div>

          <div className="p-3.5 sm:p-4 bg-emerald-50/50 border border-emerald-200 rounded-xl space-y-3">
            <div>
              <div className="text-xs font-extrabold text-emerald-900 uppercase flex items-center gap-1.5">
                <KeyRound className="w-4 h-4" /> 2. Mi Clave (DUEÑO) y Claves de Cajeros
              </div>
              <p className="text-[11px] text-gray-600 mt-0.5">
                Puedes cambiar tu propia contraseña o usuario y también modificar o crear las cuentas de tus cajeros.
              </p>
            </div>

            <div className="space-y-2.5">
              {loading ? (
                <p className="text-xs text-gray-400">Cargando usuarios...</p>
              ) : (
                usuarios.map((u) => {
                  const isOwnerRow = u.rol === 'DUENO';
                  const draft = userDrafts[u.id] || {
                    username: u.username || '',
                    password: u.password || '',
                    activo: u.activo !== false
                  };
                  const showPass = Boolean(visiblePasswords[u.id]);
                  const hasChanges =
                    draft.username !== (u.username || '') ||
                    draft.password !== (u.password || '') ||
                    (!isOwnerRow && draft.activo !== (u.activo !== false));

                  return (
                    <div
                      key={u.id}
                      className={`p-3 rounded-xl border text-xs space-y-2 ${
                        isOwnerRow
                          ? 'bg-purple-50/70 border-purple-200'
                          : 'bg-white border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-md font-extrabold text-[10px] ${
                              isOwnerRow
                                ? 'bg-yape text-white'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {isOwnerRow ? '👑 MI CUENTA (DUEÑO)' : '💼 CAJERO'}
                          </span>
                          {!isOwnerRow && (
                            <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={draft.activo}
                                onChange={(e) =>
                                  setUserDrafts({
                                    ...userDrafts,
                                    [u.id]: { ...draft, activo: e.target.checked }
                                  })
                                }
                                className="rounded text-emerald-600 focus:ring-emerald-500"
                              />
                              <span>{draft.activo ? 'Activo' : 'Pausado'}</span>
                            </label>
                          )}
                        </div>

                        {!isOwnerRow && (
                          <button
                            type="button"
                            onClick={() => handleDeleteCajero(u.id)}
                            className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition"
                            title="Eliminar este cajero"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                        <div className="sm:col-span-4">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">
                            Usuario
                          </label>
                          <input
                            type="text"
                            value={draft.username}
                            onChange={(e) =>
                              setUserDrafts({
                                ...userDrafts,
                                [u.id]: { ...draft, username: e.target.value }
                              })
                            }
                            className="w-full px-2.5 py-2 bg-white border border-gray-300 rounded-lg font-bold text-gray-800 focus:ring-2 focus:ring-yape outline-none"
                          />
                        </div>

                        <div className="sm:col-span-5">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">
                            Contraseña
                          </label>
                          <div className="relative flex items-center">
                            <input
                              type={showPass ? 'text' : 'password'}
                              value={draft.password}
                              onChange={(e) =>
                                setUserDrafts({
                                  ...userDrafts,
                                  [u.id]: { ...draft, password: e.target.value }
                                })
                              }
                              placeholder="Mínimo 4 caracteres"
                              className="w-full pl-2.5 pr-8 py-2 bg-white border border-gray-300 rounded-lg font-mono text-gray-800 focus:ring-2 focus:ring-yape outline-none"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setVisiblePasswords({
                                  ...visiblePasswords,
                                  [u.id]: !showPass
                                })
                              }
                              className="absolute right-2 text-gray-400 hover:text-gray-700"
                              title={showPass ? 'Ocultar clave' : 'Ver clave'}
                            >
                              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        <div className="sm:col-span-3">
                          <button
                            type="button"
                            disabled={savingUserId === u.id}
                            onClick={() => handleSaveUserCredentials(u)}
                            className={`w-full py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-1.5 transition shadow-sm ${
                              hasChanges
                                ? 'bg-yape hover:bg-yape-dark text-white'
                                : 'bg-gray-800 hover:bg-black text-white'
                            }`}
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>{savingUserId === u.id ? 'Guardando...' : 'Guardar Clave'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-2 border-t border-emerald-200/70">
              <span className="block text-[11px] font-bold text-emerald-900 mb-1.5 flex items-center gap-1">
                <Users className="w-3.5 h-3.5" /> Agregar Nuevo Cajero / Mostrador (No puede borrar pagos)
              </span>
              <form onSubmit={handleCreateCajero} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  required
                  placeholder="Nuevo usuario cajero"
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs"
                  value={cajeroForm.username}
                  onChange={(e) => setCajeroForm({ ...cajeroForm, username: e.target.value })}
                />
                <input
                  type="text"
                  required
                  minLength={4}
                  placeholder="Contraseña (mín. 4)"
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs"
                  value={cajeroForm.password}
                  onChange={(e) => setCajeroForm({ ...cajeroForm, password: e.target.value })}
                />
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 px-3 rounded-lg flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Crear Cajero
                </button>
              </form>
            </div>
          </div>

          <form onSubmit={handleSaveIntegrations} className="p-3.5 sm:p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
            <div className="text-xs font-extrabold text-gray-800 uppercase flex items-center gap-1.5">
              <ExternalLink className="w-4 h-4 text-blue-600" /> 3. Integración WooCommerce / Facturador (Webhook)
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Webhook URL (Recibe JSON automático en cada Yape/Plin/BBVA)
              </label>
              <input
                type="url"
                placeholder="https://mitienda.pe/api/webhook-yape"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="w-full sm:w-auto bg-gray-900 hover:bg-black text-white font-bold text-xs px-4 py-2.5 rounded-lg transition"
              >
                Guardar Webhook
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
