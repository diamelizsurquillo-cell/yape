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
  const [permissionState, setPermissionState] = useState('default');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const syncSubscriptionWithServer = useCallback(
    async (requestUserPermission = false) => {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window) ||
        !token ||
        !enabledForRole
      ) {
        return false;
      }

      let currentPerm = Notification.permission;
      setPermissionState(currentPerm);

      if (currentPerm !== 'granted') {
        if (!requestUserPermission) {
          setSubscribed(false);
          return false;
        }
        currentPerm = await Notification.requestPermission();
        setPermissionState(currentPerm);
        if (currentPerm !== 'granted') {
          setSubscribed(false);
          setStatusMsg(
            currentPerm === 'denied'
              ? 'Las notificaciones están bloqueadas en Ajustes de tu navegador/celular. Habilítalas para recibir avisos con la app cerrada.'
              : 'Debes tocar "Permitir" cuando el celular te pregunte.'
          );
          return false;
        }
      }

      // Asegurar que el Service Worker esté registrado y actualizado
      const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      await navigator.serviceWorker.ready;

      let existingSub = await reg.pushManager.getSubscription();
      const checkUrl = existingSub
        ? `${apiUrl}/api/push?endpoint=${encodeURIComponent(existingSub.endpoint)}`
        : `${apiUrl}/api/push`;

      const keyRes = await fetch(checkUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const keyData = await keyRes.json();
      if (!keyRes.ok || !keyData.publicKey) {
        setStatusMsg(keyData.error || 'No se pudo obtener la llave Push del servidor.');
        return false;
      }

      // Si ya existe en el navegador Y ya está confirmado en Supabase para este negocio -> listo
      if (existingSub && keyData.endpointRegistered && !requestUserPermission) {
        setSubscribed(true);
        return true;
      }

      // Crear suscripción Push (si cambió la llave VAPID, renovar automáticamente)
      let sub = existingSub;
      if (!sub) {
        try {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
          });
        } catch {
          const old = await reg.pushManager.getSubscription();
          if (old) await old.unsubscribe().catch(() => {});
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
          });
        }
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
        setSubscribed(false);
        setStatusMsg(saveData.error || 'Error guardando suscripción Push en el servidor.');
        return false;
      }

      setSubscribed(true);
      if (requestUserPermission) {
        setStatusMsg('¡Listo! Ya recibirás timbre y alerta aunque cierres la App.');
      }
      return true;
    },
    [token, apiUrl, enabledForRole]
  );

  useEffect(() => {
    const isSupported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setSupported(isSupported);
    if (typeof Notification !== 'undefined') {
      setPermissionState(Notification.permission);
    }

    if (!isSupported || !token || !enabledForRole) {
      setSubscribed(false);
      return;
    }

    // Auto-sincronizar silenciosamente al abrir sesión si el usuario ya había otorgado permiso
    syncSubscriptionWithServer(false).catch(() => {});
  }, [token, enabledForRole, syncSubscriptionWithServer]);

  const enablePush = useCallback(async () => {
    setBusy(true);
    setStatusMsg('');
    try {
      return await syncSubscriptionWithServer(true);
    } catch (err) {
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
      setStatusMsg(
        isIos
          ? 'En iPhone primero debes instalar la App en tu Pantalla de Inicio (Compartir -> Agregar a inicio) para activar Push.'
          : `No se pudo activar Push: ${err.message || 'revisa tu conexión'}`
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, [syncSubscriptionWithServer]);

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
      setStatusMsg('Alertas Push con App cerrada desactivadas.');
    } catch {
      // ignorar
    } finally {
      setBusy(false);
    }
  }, [supported, token, apiUrl]);

  const sendTestPush = useCallback(
    async (delayMs = 4500) => {
      if (!token) return;
      setBusy(true);
      setStatusMsg(
        delayMs > 0
          ? '⏳ ¡Cierra la App o bloquea tu pantalla AHORA! Sonará en 4 segundos...'
          : 'Enviando alerta de prueba...'
      );
      try {
        const res = await fetch(`${apiUrl}/api/push`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ action: 'test', delay_ms: delayMs })
        });
        const data = await res.json();
        setStatusMsg(data.mensaje || data.error || 'Prueba enviada.');
      } catch {
        setStatusMsg('Error de red al enviar prueba Push.');
      } finally {
        setBusy(false);
      }
    },
    [token, apiUrl]
  );

  return {
    supported,
    subscribed,
    permissionState,
    busy,
    statusMsg,
    enablePush,
    disablePush,
    sendTestPush
  };
}
