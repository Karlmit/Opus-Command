import { createContext, useContext, useState, useEffect } from 'react';

const Ctx = createContext({ isMobile: false, override: null, setOverride: () => {} });

function detectCoarsePointer() {
  return window.matchMedia('(pointer: coarse)').matches;
}

export function DeviceProvider({ children }) {
  const [override, setOverrideState] = useState(
    () => localStorage.getItem('opus-device-mode') || null // 'mobile' | 'desktop' | null
  );
  const [nativeMobile, setNativeMobile] = useState(detectCoarsePointer);

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const handler = e => setNativeMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Sync CSS class on body so layout CSS can key off it instead of width breakpoints
  const isMobile = override === 'mobile' ? true
                 : override === 'desktop' ? false
                 : nativeMobile;

  useEffect(() => {
    document.body.classList.toggle('mobile-device', isMobile);
  }, [isMobile]);

  function setOverride(mode) {
    if (mode === null) localStorage.removeItem('opus-device-mode');
    else localStorage.setItem('opus-device-mode', mode);
    setOverrideState(mode);
  }

  return (
    <Ctx.Provider value={{ isMobile, override, setOverride, nativeMobile }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDevice() { return useContext(Ctx); }
