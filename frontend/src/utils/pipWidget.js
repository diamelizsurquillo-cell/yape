// Utilidad de Ventana Emergente de Escritorio en Segundo Plano
// Se abre automáticamente en la esquina inferior derecha de Windows SOLO cuando llega un pago y se cierra sola tras 8 segundos.

let popupWindow = null;
let autoCloseTimer = null;
let currentPipWindow = null;

/**
 * Abre una ventana emergente en la esquina inferior derecha de Windows
 * únicamente cuando entra un nuevo pago y se cierra automáticamente a los 8 segundos.
 */
export function showTemporaryDesktopPopup(payment) {
  if (typeof window === 'undefined') return;

  const width = 360;
  const height = 185;
  const left = (window.screen.availWidth || 1366) - width - 20;
  const top = (window.screen.availHeight || 768) - height - 30;

  const formattedAmount = Number(payment.monto || 0).toFixed(2);
  const sender = payment.remitente || 'Cliente Yape';
  const code = payment.codigo_seguridad ? `Código: ${payment.codigo_seguridad}` : 'Pago confirmado';

  // 1. Si el Picture-in-Picture está abierto, actualizarlo
  if (currentPipWindow && !currentPipWindow.closed) {
    updateFloatingWidget(payment);
  }

  // 2. Abrir / Actualizar la ventana emergente flotante en Windows
  try {
    if (popupWindow && !popupWindow.closed) {
      const doc = popupWindow.document;
      const amountEl = doc.getElementById('pop-amount');
      const senderEl = doc.getElementById('pop-sender');
      const codeEl = doc.getElementById('pop-code');
      if (amountEl) amountEl.textContent = `S/ ${formattedAmount}`;
      if (senderEl) senderEl.textContent = sender;
      if (codeEl) codeEl.textContent = code;
      popupWindow.focus();
    } else {
      popupWindow = window.open(
        '',
        'YapeAlertPopup',
        `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=no,alwaysRaised=yes,scrollbars=no`
      );

      if (popupWindow) {
        popupWindow.document.title = `¡Yape Recibido! - S/ ${formattedAmount}`;
        popupWindow.document.head.innerHTML = `
          <meta charset="utf-8">
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
            body { 
              background: linear-gradient(135deg, #740099 0%, #9c1abf 100%); 
              color: white; 
              padding: 14px; 
              height: 100vh; 
              display: flex; 
              flex-direction: column; 
              justify-content: space-between; 
              overflow: hidden; 
              user-select: none;
              position: relative;
            }
            .header { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: bold; }
            .badge { background: rgba(0, 255, 102, 0.2); color: #00ff66; border: 1px solid #00ff66; padding: 2px 8px; border-radius: 12px; font-size: 10px; display: flex; align-items: center; gap: 4px; }
            .dot { width: 6px; height: 6px; background: #00ff66; border-radius: 50%; }
            .amount { font-size: 34px; font-weight: 900; text-align: center; margin: 4px 0; color: #ffffff; text-shadow: 0 2px 8px rgba(0,0,0,0.3); }
            .sender { font-size: 13px; font-weight: 600; text-align: center; opacity: 0.95; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .footer { display: flex; justify-content: space-between; align-items: center; font-size: 11px; opacity: 0.85; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 6px; }
            .progress { position: absolute; bottom: 0; left: 0; height: 4px; background: #00ff66; width: 100%; animation: countdown 8s linear forwards; }
            @keyframes countdown { from { width: 100%; } to { width: 0%; } }
          </style>
        `;
        popupWindow.document.body.innerHTML = `
          <div class="header">
            <span>🔔 ¡NUEVO YAPE RECIBIDO!</span>
            <div class="badge"><div class="dot"></div>EN VIVO</div>
          </div>
          <div class="amount" id="pop-amount">S/ ${formattedAmount}</div>
          <div class="sender" id="pop-sender">${sender}</div>
          <div class="footer">
            <span id="pop-code">${code}</span>
            <span>Auto-cierre en 8s</span>
          </div>
          <div class="progress"></div>
        `;
      }
    }

    // Auto cerrar después de 8 segundos
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(() => {
      try {
        if (popupWindow && !popupWindow.closed) {
          popupWindow.close();
        }
      } catch (e) {}
    }, 8000);
  } catch (err) {
    console.warn('Ventana emergente bloqueada por el navegador:', err);
  }
}

export function isPipSupported() {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

export async function openYapeFloatingWidget({ onValidatePayment }) {
  if (!isPipSupported()) {
    alert('Tu navegador no soporta Picture-in-Picture. Usaremos ventanas emergentes automáticas.');
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

    const style = pipWindow.document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
      body { background: #740099; color: white; padding: 14px; display: flex; flex-direction: column; justify-content: space-between; height: 100vh; overflow: hidden; user-select: none; }
      .header { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: bold; }
      .live-badge { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 20px; }
      .dot { width: 8px; height: 8px; background: #00ff66; border-radius: 50%; }
      .main { text-align: center; margin: 8px 0; }
      .amount { font-size: 32px; font-weight: 900; color: #fff; letter-spacing: -0.5px; }
      .sender { font-size: 13px; opacity: 0.9; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .footer { display: flex; justify-content: space-between; align-items: center; font-size: 11px; opacity: 0.8; }
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

    container.classList.remove('new-anim');
    void container.offsetWidth;
    container.classList.add('new-anim');
  } catch (e) {
    console.warn('Error actualizando widget PiP:', e);
  }
}
