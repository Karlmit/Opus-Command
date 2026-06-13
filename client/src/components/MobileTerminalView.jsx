import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from '../lib/socket';
import './MobileTerminalView.css';

// Read-only mobile viewer. The server runs a headless terminal emulator per
// session and pushes clean text "snapshots" of the current screen (handling
// cursor addressing, clear-screen, and the alternate screen for TUIs like
// Claude Code). This component just renders the latest snapshot — it never
// mounts xterm, never parses ANSI, and never resizes the PTY.

// Compact terminal switcher for mobile. The desktop .cockpit-tabs bar is hidden
// on touch layouts, so this is the only way to switch between, add, or close
// terminal sessions on a phone. Mirrors the desktop tab semantics (active
// state, AI-waiting/active highlight, close button).
export function MobileTermTabs({ tabs, activeId, onSelect, onAdd, onClose }) {
  return (
    <div className="mtt-bar" role="tablist" aria-label="Terminals">
      <div className="mtt-scroll">
        {tabs.map(t => {
          const active = t.id === activeId;
          const aiClass = t.aiState === 'waiting' ? ' ai-waiting'
            : t.aiState === 'active' ? ' ai-active' : '';
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={active}
              className={`mtt-tab${active ? ' active' : ''}${aiClass}`}
              onClick={() => onSelect(t.id)}
            >
              <span className="mtt-tab-icon" aria-hidden="true">⌨</span>
              <span className="mtt-tab-label">{t.name}</span>
              {t.aiState === 'waiting' && <span className="mtt-ai-badge" aria-hidden="true">!</span>}
              <button
                type="button"
                className="mtt-tab-close"
                aria-label={`Close ${t.name}`}
                onClick={e => { e.stopPropagation(); onClose(t.id); }}
              >×</button>
            </div>
          );
        })}
      </div>
      <button type="button" className="mtt-add" aria-label="New terminal" onClick={onAdd}>+</button>
    </div>
  );
}

export default function MobileTerminalView({ sessionId }) {
  const [lines, setLines] = useState([]);
  const [atBottom, setAtBottom] = useState(true);
  // 'loading' | 'live' | 'dead'
  const [status, setStatus] = useState('loading');
  const [desktopActive, setDesktopActive] = useState(false);
  const [input, setInput] = useState('');

  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);
  // Latest snapshot held back while the user has scrolled up (frozen), so the
  // DOM stays stable and native momentum scrolling isn't interrupted.
  const pendingRef = useRef(null);

  const stickToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  // Apply the newest snapshot and snap to the bottom. Used when following the
  // tail and when the user taps "↓ Latest" to resume.
  const applyPending = useCallback(() => {
    const next = pendingRef.current;
    if (next) {
      pendingRef.current = null;
      setLines(next);
    }
    atBottomRef.current = true;
    setAtBottom(true);
    stickToBottom();
  }, [stickToBottom]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nowAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = nowAtBottom;
    setAtBottom(nowAtBottom);
    // Reached the bottom again → flush any frozen snapshot and resume following
    if (nowAtBottom && pendingRef.current) applyPending();
  }

  // Snapshot handler. While following the tail we update live and stick to the
  // bottom. While scrolled up we DON'T touch the DOM or scrollTop (that would
  // kill the touch/inertia scroll) — we just stash the latest frame.
  const applySnapshot = useCallback((nextLines) => {
    if (atBottomRef.current) {
      setLines(nextLines);
      stickToBottom();
    } else {
      pendingRef.current = nextLines;
    }
  }, [stickToBottom]);

  useEffect(() => {
    if (!sessionId) return;
    setLines([]);
    setStatus('loading');
    setDesktopActive(false);
    setAtBottom(true);
    atBottomRef.current = true;
    pendingRef.current = null;

    const sock = getSocket();

    function onSnapshot({ sessionId: sid, lines: snapLines, desktopAttached }) {
      if (sid !== sessionId) return;
      setStatus('live');
      setDesktopActive(!!desktopAttached);
      applySnapshot(Array.isArray(snapLines) ? snapLines : []);
    }

    function onAttached({ sessionId: sid }) {
      if (sid !== sessionId) return;
      setStatus('live');
    }

    function onDead({ sessionId: sid }) {
      if (sid !== sessionId) return;
      setStatus('dead');
    }

    function onConnect() {
      sock.emit('terminal:join-viewer', { sessionId });
    }

    sock.on('terminal:snapshot', onSnapshot);
    sock.on('terminal:session-attached', onAttached);
    sock.on('terminal:session-dead', onDead);
    sock.on('connect', onConnect);

    if (sock.connected) sock.emit('terminal:join-viewer', { sessionId });

    return () => {
      sock.emit('terminal:leave', { sessionId });
      sock.off('terminal:snapshot', onSnapshot);
      sock.off('terminal:session-attached', onAttached);
      sock.off('terminal:session-dead', onDead);
      sock.off('connect', onConnect);
    };
  }, [sessionId, applySnapshot]);

  function sendRaw(data) {
    const sock = getSocket();
    if (sock.connected) sock.emit('terminal:input', { sessionId, data });
  }

  function handleSend() {
    if (!input) return;
    sendRaw(input + '\r');
    setInput('');
  }

  function handleInputKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const statusLabel =
    status === 'loading' ? 'Connecting…'
    : status === 'dead' ? 'Session ended'
    : desktopActive ? 'Read-only · Desktop active'
    : 'Read-only · Live';

  return (
    <div className="mtv">
      {/* Status label */}
      <div className={`mtv-status mtv-status-${status}`}>
        <span className="mtv-status-dot" />
        {statusLabel}
      </div>

      {/* Output log */}
      <div className="mtv-output" ref={scrollRef} onScroll={handleScroll}>
        {status === 'loading' && <div className="mtv-notice">Connecting…</div>}
        {status === 'dead' && <div className="mtv-notice mtv-notice-dead">Session ended</div>}
        {lines.map((line, i) => (
          <div key={i} className="mtv-line">{line || ' '}</div>
        ))}
      </div>

      {/* Jump to bottom — also flushes the frozen snapshot and resumes following */}
      {!atBottom && (
        <button className="mtv-jump" onClick={applyPending}>
          ↓ Latest
        </button>
      )}

      {/* Input bar */}
      <div className="mtv-input-bar">
        <div className="mtv-quick-keys">
          <button className="mtv-qkey" onClick={() => sendRaw('\r')}>↵ Enter</button>
          <button className="mtv-qkey" onClick={() => sendRaw('\x03')}>Ctrl+C</button>
          <button className="mtv-qkey" onClick={() => sendRaw('\x1b')}>Esc</button>
          <button className="mtv-qkey" onClick={() => sendRaw('\x1b[A')}>↑</button>
          <button className="mtv-qkey" onClick={() => sendRaw('\x1b[B')}>↓</button>
          <button className="mtv-qkey" onClick={() => sendRaw('\t')}>Tab</button>
        </div>
        <div className="mtv-input-row">
          <textarea
            className="mtv-textarea"
            value={input}
            rows={1}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type command…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <button className="mtv-send" onClick={handleSend} disabled={!input}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
