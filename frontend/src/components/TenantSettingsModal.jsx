import React, { useState, useEffect } from 'react';
import {
  X, Key, Copy, Check, Users, Plus, Trash2, Play, ExternalLink, Smartphone
} from 'lucide-react';

export default function TenantSettingsModal({ token, apiUrl, user, onClose, onProfileUpdated }) {
  const [negocio, setNegocio] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [webhookUrl, setWebhookUrl] = useState(user?.webhook_url || '');
  const [whatsappAlerta, setWhatsappAlerta] = useState(user?.whatsapp_alerta || '');
  const [cajeroForm, setCajeroForm] = useState({ username: '', password: '', nombre_mostrar: '' });
  const [copied, setCopied] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

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
        setNegocio(data.negocio);
        setUsuarios(data.usuarios || []);
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
    } catch (err) {
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
    } catch (err) {
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
      loadMyBusiness();
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

  const activeApiKey = negocio?.api_key || user?.api_key || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 border border-gray-100 relative my-8">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-extrabold text-gray-900">
          Configuración de Mi Negocio: {negocio?.nombre_comercial || user?.nombre_comercial}
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Vincula tu celular Android, administra a tus cajeros y conecta tus integraciones.
        </p>

        {msg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
            {msg}
          </div>
        )}

        <div className="space-y-5 text-sm max-h-[75vh] overflow-y-auto pr-1">
          {/* 1. Conexión App Android Sensor */}
          <div className="p-4 bg-purple-50/60 border border-purple-200 rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-extrabold text-yape uppercase flex items-center gap-1.5">
                <Smartphone className="w-4 h-4" /> 1. Vincular Celular Android (App Sensor)
              </span>
              <button
                type="button"
                onClick={handleTestMySensor}
                className="bg-yape hover:bg-yape-dark text-white text-xs font-bold px-3 py-1 rounded-lg flex items-center gap-1"
              >
                <Play className="w-3 h-3 fill-white" /> Simular Pago S/ 15.50
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
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

          {/* 2. Cajeros / Modo Satélite */}
          <div className="p-4 bg-emerald-50/50 border border-emerald-200 rounded-xl">
            <div className="text-xs font-extrabold text-emerald-900 uppercase flex items-center gap-1.5 mb-2">
              <Users className="w-4 h-4" /> 2. Mis Cajeros / Mostrador (No pueden borrar historial)
            </div>

            <div className="space-y-2 mb-3">
              {loading ? (
                <p className="text-xs text-gray-400">Cargando usuarios...</p>
              ) : (
                usuarios.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-gray-200 text-xs"
                  >
                    <div>
                      <span
                        className={`px-1.5 py-0.5 rounded font-bold text-[10px] mr-2 ${
                          u.rol === 'DUENO'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {u.rol}
                      </span>
                      <strong className="text-gray-800">{u.username}</strong>
                      <span className="text-gray-400 ml-2">Clave: {u.password}</span>
                    </div>
                    {u.rol !== 'DUENO' && (
                      <button
                        onClick={() => handleDeleteCajero(u.id)}
                        className="text-gray-400 hover:text-red-600 p-1"
                        title="Eliminar cajero"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleCreateCajero} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                required
                placeholder="Nuevo usuario cajero"
                className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs"
                value={cajeroForm.username}
                onChange={(e) => setCajeroForm({ ...cajeroForm, username: e.target.value })}
              />
              <input
                type="text"
                required
                placeholder="Contraseña"
                className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs"
                value={cajeroForm.password}
                onChange={(e) => setCajeroForm({ ...cajeroForm, password: e.target.value })}
              />
              <button
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-1.5 px-3 rounded-lg flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Crear Cajero
              </button>
            </form>
          </div>

          {/* 3. Webhook E-commerce / Facturador + WhatsApp Delivery */}
          <form onSubmit={handleSaveIntegrations} className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
            <div className="text-xs font-extrabold text-gray-800 uppercase flex items-center gap-1.5">
              <ExternalLink className="w-4 h-4 text-blue-600" /> 3. Integración WooCommerce / Facturador & WhatsApp Delivery
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

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Número WhatsApp de Repartidor / Cocina (con código país, ej: 51999888777)
              </label>
              <input
                type="text"
                placeholder="51999888777"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs"
                value={whatsappAlerta}
                onChange={(e) => setWhatsappAlerta(e.target.value)}
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Habilita el botón rápido "Enviar a WhatsApp" en cada pago recibido para avisar al repartidor o encargado.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="bg-gray-900 hover:bg-black text-white font-bold text-xs px-4 py-2 rounded-lg transition"
              >
                Guardar Integraciones
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
