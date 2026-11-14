import { useState, useEffect } from 'react';

function computeViewportProfile() {
  if (typeof window === 'undefined') {
    return {
      width: 1280,
      height: 800,
      deviceType: 'pc',
      deviceLabel: 'PC',
      isMobile: false,
      isTablet: false,
      isPC: true,
      isCompactHeight: false,
      isTouch: false,
      useCardLayout: false,
      resolutionText: '1280×800'
    };
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const ua = (navigator.userAgent || '').toLowerCase();
  const coarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const isTouch = coarsePointer || (navigator.maxTouchPoints || 0) > 0;

  const uaMobile = /android.+mobile|iphone|ipod|blackberry|iemobile|opera mini/.test(ua);
  const uaTablet = /ipad|tablet|(android(?!.*mobile))/.test(ua);

  let deviceType = 'pc';
  let deviceLabel = 'PC Escritorio';

  if (width < 640 || (uaMobile && width < 768)) {
    deviceType = 'mobile';
    deviceLabel = 'Celular';
  } else if (width < 1024 || (uaTablet && width <= 1180 && isTouch)) {
    deviceType = 'tablet';
    deviceLabel = 'Tablet';
  } else if (height < 740 || width < 1400) {
    deviceType = 'pc-compact';
    deviceLabel = 'PC Compacta';
  } else {
    deviceType = 'pc';
    deviceLabel = 'Monitor PC';
  }

  const isMobile = deviceType === 'mobile';
  const isTablet = deviceType === 'tablet';
  const isPC = deviceType === 'pc' || deviceType === 'pc-compact';
  const isCompactHeight = height < 740;

  return {
    width,
    height,
    deviceType,
    deviceLabel,
    isMobile,
    isTablet,
    isPC,
    isCompactHeight,
    isTouch,
    useCardLayout: isMobile || isTablet,
    resolutionText: `${width}×${height}`
  };
}

export function useDeviceViewport() {
  const [viewport, setViewport] = useState(computeViewportProfile);

  useEffect(() => {
    let rafId = null;
    const handleResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setViewport(computeViewportProfile());
      });
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return viewport;
}
