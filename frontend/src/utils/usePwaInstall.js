import { useState, useEffect, useCallback } from 'react';

function detectStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    window.navigator.standalone === true
  );
}

function detectPlatform() {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = (navigator.userAgent || '').toLowerCase();
  const isIosDevice =
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIosDevice) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'desktop';
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(() =>
    typeof window !== 'undefined' ? window.__deferredPwaPrompt || null : null
  );
  const [isStandalone, setIsStandalone] = useState(detectStandalone);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const platform = detectPlatform();

  useEffect(() => {
    const syncPrompt = () => {
      if (window.__deferredPwaPrompt) {
        setDeferredPrompt(window.__deferredPwaPrompt);
      }
    };

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      window.__deferredPwaPrompt = e;
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      window.__deferredPwaPrompt = null;
      setDeferredPrompt(null);
      setIsStandalone(true);
      setShowGuideModal(false);
    };

    const mql = window.matchMedia('(display-mode: standalone)');
    const handleDisplayChange = () => setIsStandalone(detectStandalone());

    window.addEventListener('pwa-prompt-ready', syncPrompt);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    if (mql.addEventListener) {
      mql.addEventListener('change', handleDisplayChange);
    }

    syncPrompt();

    return () => {
      window.removeEventListener('pwa-prompt-ready', syncPrompt);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      if (mql.removeEventListener) {
        mql.removeEventListener('change', handleDisplayChange);
      }
    };
  }, []);

  const triggerInstall = useCallback(async () => {
    const promptEvent = deferredPrompt || (typeof window !== 'undefined' ? window.__deferredPwaPrompt : null);
    if (promptEvent) {
      try {
        promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice?.outcome === 'accepted') {
          window.__deferredPwaPrompt = null;
          setDeferredPrompt(null);
        }
        return { outcome: choice?.outcome || 'dismissed', usedNativePrompt: true };
      } catch {
        setShowGuideModal(true);
        return { outcome: 'guide', usedNativePrompt: false };
      }
    }

    // Si el navegador es Safari iOS o ya se usó el prompt nativo, abrir guía visual asistida
    setShowGuideModal(true);
    return { outcome: 'guide', usedNativePrompt: false };
  }, [deferredPrompt]);

  return {
    isStandalone,
    canPromptNative: Boolean(deferredPrompt),
    platform,
    showGuideModal,
    setShowGuideModal,
    triggerInstall
  };
}
