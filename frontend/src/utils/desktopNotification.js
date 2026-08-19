// Utilidad para notificaciones nativas de escritorio del navegador (Windows / Mac / Linux)

/**
 * Solicita permiso al usuario para mostrar notificaciones de escritorio en segundo plano.
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('Este navegador no soporta notificaciones de escritorio');
    return 'unsupported';
  }
  
  if (Notification.permission === 'granted') {
    return 'granted';
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (err) {
    console.error('Error al solicitar permiso de notificaciones:', err);
    return 'denied';
  }
}

/**
 * Muestra una notificación flotante de Windows / Sistema en segundo plano,
 * visible incluso si el usuario está en otra pestaña, programa o aplicación.
 */
export function showDesktopNotification({ monto, remitente, codigo_seguridad }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  try {
    const formattedAmount = Number(monto || 0).toFixed(2);
    const title = `🔔 ¡Yape Recibido: S/ ${formattedAmount}!`;
    let body = `Cliente: ${remitente || 'No especificado'}`;
    if (codigo_seguridad) {
      body += ` | Cód: ${codigo_seguridad}`;
    }

    const notification = new Notification(title, {
      body: body,
      icon: 'https://img.icons8.com/color/96/000000/yape.png',
      tag: `yape-pago-${Date.now()}`,
      requireInteraction: false,
      silent: true // La voz y la campana ya emiten el sonido
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    // Cerrar automáticamente después de 10 segundos
    setTimeout(() => {
      try {
        notification.close();
      } catch (e) {}
    }, 10000);
  } catch (err) {
    console.warn('Error al mostrar notificación de escritorio:', err);
  }
}
