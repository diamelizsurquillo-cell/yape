import { useState, useEffect, useRef, useCallback } from 'react';

export function useScreenWakeLock() {
  const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [wanted, setWanted] = useState(() => localStorage.getItem('yape_wake_lock') === 'true');
  const [active, setActive] = useState(false);
  const sentinelRef = useRef(null);

  const acquire = useCallback(async () => {
    if (!isSupported) return false;
    try {
      if (sentinelRef.current && !sentinelRef.current.released) {
        setActive(true);
        return true;
      }
      const lock = await navigator.wakeLock.request('screen');
      sentinelRef.current = lock;
      setActive(true);
      lock.addEventListener('release', () => {
        setActive(false);
      });
      return true;
    } catch {
      setActive(false);
      return false;
    }
  }, [isSupported]);

  const release = useCallback(async () => {
    try {
      if (sentinelRef.current) {
        await sentinelRef.current.release();
        sentinelRef.current = null;
      }
    } catch {
      // ignorar
    }
    setActive(false);
  }, []);

  useEffect(() => {
    localStorage.setItem('yape_wake_lock', String(wanted));
    if (wanted) {
      acquire();
    } else {
      release();
    }
  }, [wanted, acquire, release]);

  useEffect(() => {
    if (!isSupported || !wanted) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && wanted) {
        acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isSupported, wanted, acquire]);

  const toggleWakeLock = useCallback(() => {
    setWanted((prev) => !prev);
  }, []);

  return {
    isSupported,
    wanted,
    active,
    toggleWakeLock
  };
}
