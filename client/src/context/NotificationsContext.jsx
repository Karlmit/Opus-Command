import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const NotificationsContext = createContext(null);

let globalSocket = null;

export function NotificationsProvider({ children }) {
  const [aiNotifications, setAiNotifications] = useState({}); // sessionId -> 'active'|'waiting'|'none'
  const soundSettingsRef = useRef({ enabled: false, sound: 'chime' });

  useEffect(() => {
    // Load sound settings
    fetch('/api/settings/sound').then(r => r.json()).then(d => {
      soundSettingsRef.current = { enabled: d.enabled, sound: d.sound || 'chime' };
    }).catch(() => {});

    if (!globalSocket) {
      globalSocket = io({ autoConnect: true, reconnection: true });
    }
    const sock = globalSocket;

    sock.on('terminal:ai-state', ({ sessionId, state }) => {
      setAiNotifications(prev => ({ ...prev, [sessionId]: state }));

      // Play sound for waiting state
      if (state === 'waiting' && soundSettingsRef.current.enabled) {
        playNotificationSound(soundSettingsRef.current.sound);
      }
    });

    return () => {
      sock.off('terminal:ai-state');
    };
  }, []);

  function playNotificationSound(type) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const freqs = { chime: 880, ping: 660, ding: 440 };
      osc.frequency.value = freqs[type] || 660;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (_) {}
  }

  const waitingCount = Object.values(aiNotifications).filter(s => s === 'waiting').length;

  return (
    <NotificationsContext.Provider value={{ aiNotifications, waitingCount }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
