// Utilidad para sintetizar voz y reproducir sonido de alerta para pagos de Yape

/**
 * Convierte un monto numérico a formato hablado natural en español.
 * Ejemplos:
 * 50 -> "50 soles"
 * 12.50 -> "12 soles con 50 céntimos"
 * 1 -> "1 sol"
 * 0.50 -> "50 céntimos"
 */
export function formatAmountToSpeech(amount) {
  const num = Number(amount) || 0;
  const soles = Math.floor(num);
  const centimos = Math.round((num - soles) * 100);

  let text = '';
  if (soles === 0 && centimos > 0) {
    text = `${centimos} céntimo${centimos === 1 ? '' : 's'}`;
  } else if (soles === 1 && centimos === 0) {
    text = `1 sol`;
  } else if (soles === 1 && centimos > 0) {
    text = `1 sol con ${centimos} céntimo${centimos === 1 ? '' : 's'}`;
  } else if (soles > 1 && centimos === 0) {
    text = `${soles} soles`;
  } else {
    text = `${soles} soles con ${centimos} céntimo${centimos === 1 ? '' : 's'}`;
  }
  return text;
}

/**
 * Reproduce un tono de campana (chime) nítido antes de la locución
 * utilizando Web Audio API nativo (no requiere archivos externos de audio).
 */
export function playChime(volume = 1) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;
    
    // Tono 1 (Armónico agradable)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // Re (D5)
    gain1.gain.setValueAtTime(0.25 * volume, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Tono 2 (Campana aguda)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.12); // La (A5)
    gain2.gain.setValueAtTime(0.3 * volume, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.6);
  } catch (err) {
    console.warn('No se pudo reproducir el chime de audio:', err);
  }
}

/**
 * Anuncia por voz el pago de Yape con la palabra "¡Yape!" y el monto recibido.
 */
export function speakPayment({ 
  monto, 
  remitente = '', 
  soundEnabled = true, 
  includeSender = false, 
  volume = 1,
  speechRate = 1.0 
}) {
  if (!soundEnabled) return;
  if (!('speechSynthesis' in window)) {
    console.warn('Web Speech API no disponible en este navegador');
    return;
  }

  // Reproducir chime primero
  playChime(volume);

  const amountText = formatAmountToSpeech(monto);
  let phrase = `¡Yape! ${amountText}`;
  if (includeSender && remitente) {
    phrase += ` de ${remitente}`;
  }

  // Pequeña pausa para que suene la campana antes de hablar
  setTimeout(() => {
    try {
      window.speechSynthesis.cancel(); // Cancelar locución previa si estaba hablando
      const utterance = new SpeechSynthesisUtterance(phrase);
      utterance.lang = 'es-PE';
      utterance.rate = speechRate;
      utterance.pitch = 1.05;
      utterance.volume = volume;

      // Buscar la mejor voz en español disponible en el navegador
      const voices = window.speechSynthesis.getVoices();
      const spanishVoice = voices.find(v => v.lang === 'es-PE') ||
                           voices.find(v => v.lang === 'es-419') ||
                           voices.find(v => v.lang === 'es-MX') ||
                           voices.find(v => v.lang.startsWith('es'));
      if (spanishVoice) {
        utterance.voice = spanishVoice;
      }

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error('Error al sintetizar voz:', err);
    }
  }, 350);
}
