// Utilidad de Ventana Flotante "Always on Top" (Picture-in-Picture de Documento)
// Permite tener una mini ventana flotante de Yape SIEMPRE VISIBLE encima de Excel, WhatsApp, etc.

let currentPipWindow = null;

export function isPipSupported() {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

export async function openYapeFloatingWidget({ onValidatePayment }) {
  if (!isPipSupported()) {
    alert('Tu navegador no soporta la ventana flotante siempre visible. Te recomendamos usar Google Chrome o Microsoft Edge.');
    return null;
  }

  if (currentPipWindow) {
    currentPipWindow.focus();
    return currentPipWindow;
  }

  try {
    const pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 360,
      height: 180
    });

    currentPipWindow = pipWindow;

    // Inyectar estilos básicos
    const style = pipWindow.document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
      body { background: #740099; color: white; padding: 14px; display: flex; flex-direction: column; justify-content: space-between; height: 100vh; overflow: hidden; user-select: none; }
      .header { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: bold; }
      .live-badge { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.2); padding: 2px 8px; rounded: 12px; border-radius: 20px; }
      .dot { width: 8px; height: 8px; background: #00ff66; border-radius: 50%; animation: pulse 1.5s infinite; }
      .main { text-align: center; margin: 8px 0; }
      .amount { font-size: 32px; font-weight: 900; color: #fff; letter-spacing: -0.5px; }
      .sender { font-size: 13px; opacity: 0.9; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .footer { display: flex; justify-content: space-between; align-items: center; font-size: 11px; opacity: 0.8; }
      @keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.2); } 100% { opacity: 1; transform: scale(1); } }
      .new-anim { animation: highlight 1s ease-out; }
      @keyframes highlight { 0% { background: #00b347; } 100% { background: #740099; } }
    `;
    pipWindow.document.head.appendChild(style);

    pipWindow.document.body.innerHTML = `
      <div id="pip-container" style="display: flex; flex-direction: column; justify-content: space-between; height: 100%;">
        <div class="header">
          <span style="letter-spacing: 1px;">YAPE MONITOR</span>
          <div class="live-badge">
            <div class="dot"></div>
            <span>EN VIVO</span>
          </div>
        </div>
        <div class="main">
          <div id="pip-amount" class="amount">Esperando...</div>
          <div id="pip-sender" class="sender">Listo para recibir pagos</div>
        </div>
        <div class="footer">
          <span id="pip-time">Mini-Widget activo</span>
          <span id="pip-code"></span>
        </div>
      </div>
    `;

    pipWindow.addEventListener('pagehide', () => {
      currentPipWindow = null;
    });

    return pipWindow;
  } catch (err) {
    console.error('Error al abrir Picture-in-Picture:', err);
    return null;
  }
}

/**
 * Actualiza el contenido de la ventana flotante siempre visible
 */
export function updateFloatingWidget(payment) {
  if (!currentPipWindow || currentPipWindow.closed) return;

  try {
    const doc = currentPipWindow.document;
    const amountEl = doc.getElementById('pip-amount');
    const senderEl = doc.getElementById('pip-sender');
    const codeEl = doc.getElementById('pip-code');
    const timeEl = doc.getElementById('pip-time');
    const container = doc.body;

    if (amountEl) amountEl.textContent = `S/ ${Number(payment.monto).toFixed(2)}`;
    if (senderEl) senderEl.textContent = payment.remitente || 'Cliente Yape';
    if (codeEl) codeEl.textContent = payment.codigo_seguridad ? `Cód: ${payment.codigo_seguridad}` : '';
    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    // Efecto visual de flash
    container.classList.remove('new-anim');
    void container.offsetWidth; // trigger reflow
    container.classList.add('new-anim');
  } catch (e) {
    console.warn('Error actualizando widget PiP:', e);
  }
}
