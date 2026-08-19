// Mini-Widget Flotante PiP (Picture-in-Picture)
// Se actualiza mediante BroadcastChannel para máxima confiabilidad

const PIP_CHANNEL_NAME = 'yape-pip-updates';
let currentPipWindow = null;

export function isPipSupported() {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

/**
 * Envía datos del pago al widget PiP mediante BroadcastChannel.
 * Este método es más confiable que acceder al DOM directamente.
 */
export function updateFloatingWidget(payment) {
  try {
    const bc = new BroadcastChannel(PIP_CHANNEL_NAME);
    bc.postMessage({
      type: 'NEW_PAYMENT',
      monto: Number(payment.monto || 0).toFixed(2),
      remitente: payment.remitente || 'Cliente Yape',
      codigo_seguridad: payment.codigo_seguridad || '',
      timestamp: new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
    });
    bc.close();
  } catch (e) {
    console.warn('Error enviando update al widget:', e);
  }
}

/**
 * Abre el mini widget flotante PiP
 */
export async function openYapeFloatingWidget() {
  if (!isPipSupported()) {
    alert('Tu navegador no soporta la ventana flotante. Usa Google Chrome versión 116 o superior.');
    return null;
  }

  if (currentPipWindow && !currentPipWindow.closed) {
    currentPipWindow.focus();
    return currentPipWindow;
  }

  try {
    const pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 380,
      height: 190
    });

    currentPipWindow = pipWindow;

    const style = pipWindow.document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
      body { 
        background: linear-gradient(135deg, #740099 0%, #9c27b0 100%); 
        color: white; padding: 16px; 
        display: flex; flex-direction: column; justify-content: space-between; 
        height: 100vh; overflow: hidden; user-select: none; 
      }
      .header { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: bold; letter-spacing: 1px; }
      .live-badge { display: flex; align-items: center; gap: 5px; background: rgba(0,255,102,0.15); border: 1px solid #00ff66; padding: 2px 10px; border-radius: 20px; font-size: 10px; }
      .dot { width: 7px; height: 7px; background: #00ff66; border-radius: 50%; animation: pulse 1.5s infinite; }
      .main { text-align: center; }
      .amount { font-size: 36px; font-weight: 900; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.3); transition: all 0.3s ease; }
      .sender { font-size: 14px; opacity: 0.9; margin-top: 3px; font-weight: 500; }
      .footer { display: flex; justify-content: space-between; align-items: center; font-size: 11px; opacity: 0.75; }
      @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      @keyframes flash { 0% { background: linear-gradient(135deg, #00b347 0%, #00e65c 100%); } 100% { background: linear-gradient(135deg, #740099 0%, #9c27b0 100%); } }
      .flash { animation: flash 1.2s ease-out; }
    `;
    pipWindow.document.head.appendChild(style);

    pipWindow.document.body.innerHTML = `
      <div class="header">
        <span>YAPE MONITOR</span>
        <div class="live-badge"><div class="dot"></div> EN VIVO</div>
      </div>
      <div class="main">
        <div id="pip-amount" class="amount">Esperando...</div>
        <div id="pip-sender" class="sender">Listo para recibir pagos</div>
      </div>
      <div class="footer">
        <span id="pip-time">Mini-Widget activo</span>
        <span id="pip-code"></span>
      </div>
    `;

    // Escuchar pagos via BroadcastChannel (la forma más confiable)
    const bc = new BroadcastChannel(PIP_CHANNEL_NAME);
    bc.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'NEW_PAYMENT') {
        const amountEl = pipWindow.document.getElementById('pip-amount');
        const senderEl = pipWindow.document.getElementById('pip-sender');
        const codeEl = pipWindow.document.getElementById('pip-code');
        const timeEl = pipWindow.document.getElementById('pip-time');

        if (amountEl) amountEl.textContent = 'S/ ' + data.monto;
        if (senderEl) senderEl.textContent = data.remitente;
        if (codeEl) codeEl.textContent = data.codigo_seguridad ? 'Cód: ' + data.codigo_seguridad : '';
        if (timeEl) timeEl.textContent = data.timestamp;

        // Flash verde
        pipWindow.document.body.classList.remove('flash');
        void pipWindow.document.body.offsetWidth;
        pipWindow.document.body.classList.add('flash');
      }
    };

    pipWindow.addEventListener('pagehide', () => {
      currentPipWindow = null;
      bc.close();
    });

    return pipWindow;
  } catch (err) {
    console.error('Error al abrir PiP:', err);
    return null;
  }
}
