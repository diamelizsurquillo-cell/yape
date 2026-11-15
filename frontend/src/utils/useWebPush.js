import { useState, useEffect, useCallback } from 'react';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function useWebPush({ token, apiUrl, enabledForRole }) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    const isSupported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setSupported(isSupported);
    if (!isSupported || !token || !enabledForRole) {
      setSubscribed(false);
      return;
    }

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setSubscribed(Boolean(sub));
      })
      .catch(() => {});
  }, [token, enabledForRole]);

  const enablePush = useCallback(async () => {
    if (!supported || !token) return false;
    setBusy(true);
    setStatusMsg('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatusMsg('Debes aceptar el permiso de notificaciones del navegador.');
        return false;
      }

      const keyRes = await fetch(`${apiUrl}/api/push`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const keyData = await keyRes.json();
      if (!keyRes.ok || !keyData.publicKey) {
        setStatusMsg(keyData.error || 'No se pudo obtener la llave VAPID del servidor.');
        return false;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
        });
      }

      const saveRes = await fetch(`${apiUrl}/api/push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'subscribe',
          subscription: sub.toJSON()
        })
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) {
        setStatusMsg(saveData.error || 'Error guardando suscripción Push.');
        return false;
      }

      setSubscribed(true);
      setStatusMsg('¡Alertas con App Cerrada activadas en este equipo!');
      return true;
    } catch (err) {
      setStatusMsg(`No se pudo activar Push: ${err.message || 'verifica conexión HTTPS'}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, token, apiUrl]);

  const disablePush = useCallback(async () => {
    if (!supported || !token) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch(`${apiUrl}/api/push`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ endpoint })
        });
      }
      setSubscribed(false);
      setStatusMsg('Alertas Push en segundo plano desactivadas.');
    } catch {
      // ignorar
    } finally {
      setBusy(false);
    }
  }, [supported, token, apiUrl]);

  const sendTestPush = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'test' })
      });
      const data = await res.json();
      setStatusMsg(data.mensaje || data.error || 'Prueba enviada.');
    } catch {
      setStatusMsg('Error de red al enviar prueba Push.');
    } finally {
      setBusy(false);
    }
  }, [token, apiUrl]);

  return {
    supported,
    subscribed,
    busy,
    statusMsg,
    enablePush,
    disablePush,
    sendTestPush
  };
}
