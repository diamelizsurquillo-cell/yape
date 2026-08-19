// Utilidad de notificaciones nativas para Windows / Mac / Linux (Chrome, Edge, Firefox, Brave)

// Registrar Service Worker automáticamente si el navegador lo soporta
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.warn('No se pudo registrar ServiceWorker para notificaciones:', err);
  });
}

/**
 * Solicita permiso de notificaciones de escritorio al usuario.
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    alert('Tu navegador no soporta notificaciones de escritorio. Te recomendamos usar Google Chrome o Microsoft Edge.');
    return 'unsupported';
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'denied') {
      alert('Las notificaciones están bloqueadas en tu navegador. Haz clic en el icono del candado 🔒 junto a la URL en la barra de direcciones y cambia Notificaciones a "Permitir".');
    }
    return permission;
  } catch (err) {
    console.error('Error al solicitar permiso de notificaciones:', err);
    return 'denied';
  }
}

/**
 * Dispara una notificación de escritorio nativa de Windows que se muestra
 * aunque el navegador esté minimizado, en segundo plano o en otra ventana.
 */
export async function showDesktopNotification({ monto, remitente, codigo_seguridad }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const formattedAmount = Number(monto || 0).toFixed(2);
  const title = `💰 ¡YAPE RECIBIDO: S/ ${formattedAmount}!`;
  let bodyText = `Cliente: ${remitente || 'No especificado'}`;
  if (codigo_seguridad) {
    bodyText += ` | Código: ${codigo_seguridad}`;
  }

  const options = {
    body: bodyText,
    icon: 'https://img.icons8.com/color/96/000000/yape.png',
    badge: 'https://img.icons8.com/color/96/000000/yape.png',
    tag: `yape-payment-${Date.now()}`,
    renotify: true,
    requireInteraction: true, // Mantener visible en Windows hasta que el usuario interactúe
    silent: true // La voz del parlante ya reproduce el audio
  };

  try {
    // 1. Intentar mediante Service Worker (el método más confiable para Windows en segundo plano)
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      if (registration && registration.showNotification) {
        await registration.showNotification(title, options);
        return;
      }
    }

    // 2. Fallback estándar si no hay Service Worker activo
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch (err) {
    console.warn('Error al mostrar notificación nativa:', err);
    try {
      new Notification(title, options);
    } catch (e) {}
  }
}
