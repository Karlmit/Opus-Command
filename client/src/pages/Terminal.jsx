import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import '@xterm/xterm/css/xterm.css';
import './Terminal.css';

// Singleton socket shared across renders
let socket = null;
function getSocket() {
  if (!socket) {
    socket = io({ autoConnect: true, reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: 30 });
  }
  return socket;
}

// Terminal state machine values:
//   connecting  — join/reattach sent, waiting for server response
//   attached    — server confirmed PTY is live
//   detached    — socket disconnected (transient)
//   dead        — server confirmed PTY is gone (session orphaned after restart)

/* ── Terminal Tab ── */
function TerminalTab({ session, active, onSelect, onRename, onClose }) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(session.name);
  const [confirmClose, setConfirmClose] = useState(false);
  const inputRef = useRef(null);

  function startRename() {
    setNewName(session.name);
    setRenaming(true);
    setTimeout(() => inputRef.current?.focus(), 10);
  }

  function submitRename(e) {
    e.preventDefault();
    if (newName.trim()) onRename(session.id, newName.trim());
    setRenaming(false);
  }

  function handleClose(e) {
    e.stopPropagation();
    if (confirmClose) {
      onClose(session.id);
      setConfirmClose(false);
    } else {
      setConfirmClose(true);
      setTimeout(() => setConfirmClose(false), 3000);
    }
  }

  return (
    <div
      className={`terminal-tab${active ? ' active' : ''}${session.aiState !== 'none' ? ` ai-${session.aiState}` : ''}`}
      onClick={() => onSelect(session.id)}
      role="tab"
      aria-selected={active}
    >
      <span className="terminal-tab-icon">▶</span>

      {renaming ? (
        <form onSubmit={submitRename} onClick={e => e.stopPropagation()}>
          <input
            ref={inputRef}
            className="terminal-tab-rename-input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={() => setRenaming(false)}
            onKeyDown={e => e.key === 'Escape' && setRenaming(false)}
          />
        </form>
      ) : (
        <span className="terminal-tab-name" onDoubleClick={startRename}>{session.name}</span>
      )}

      {session.aiState === 'waiting' && (
        <span className="badge-ai terminal-tab-ai-badge" aria-live="polite" aria-atomic="true">
          Waiting
        </span>
      )}

      {active && !renaming && (
        <button
          className={`terminal-tab-close${confirmClose ? ' confirming' : ''}`}
          onClick={handleClose}
          title={confirmClose ? 'Click again to kill' : 'Close'}
        >
          {confirmClose ? 'Kill?' : '×'}
        </button>
      )}
    </div>
  );
}

/* ── Main terminal page ── */
export default function TerminalPage() {
  const { id: projectId } = useParams();
  const { csrfToken } = useAuth();
  const { addToast } = useToast();

  const [sessions, setSessions]         = useState([]);
  const [activeSessionId, setActive]    = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectTime, setReconnectTime] = useState(0);
  const [sessionDead, setSessionDead]   = useState(false);

  // xterm lives in refs — never re-created on re-render
  const terminalRef    = useRef(null); // DOM div
  const xtermRef       = useRef(null); // XTerm instance
  const fitAddonRef    = useRef(null); // FitAddon instance
  const currentSession = useRef(null); // currently joined session ID
  // session ID queued for join while socket was disconnected
  const pendingJoinRef = useRef(null);
  // terminal state: 'connecting' | 'attached' | 'detached' | 'dead'
  const terminalStateRef = useRef('connecting');

  /* ── 1. Initialize xterm once the DOM div mounts ── */
  useEffect(() => {
    const div = terminalRef.current;
    if (!div || xtermRef.current) return; // already initialized

    const term = new XTerm({
      convertEol: true, // treat bare \n as \r\n so output never overwrites the same line
      theme: {
        background: '#1E2024',
        foreground: '#E8EAED',
        cursor: '#3B82F6',
        selectionBackground: 'rgba(59,130,246,0.30)',
      },
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', ui-monospace, monospace",
      fontSize: 14,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(div);

    xtermRef.current   = term;
    fitAddonRef.current = fitAddon;

    // Keyboard → socket; blocked when session is dead
    term.onData(data => {
      if (terminalStateRef.current === 'dead') {
        console.log('[terminal] input blocked: session is dead');
        return;
      }
      const sock = getSocket();
      if (currentSession.current && sock.connected) {
        sock.emit('terminal:input', { sessionId: currentSession.current, data });
      }
    });

    // Resize observer → fit + notify server; blocked when session is dead
    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch (_) {}
      if (terminalStateRef.current === 'dead') {
        console.log('[terminal] resize blocked: session is dead');
        return;
      }
      if (currentSession.current && term.cols > 0 && term.rows > 0) {
        getSocket().emit('terminal:resize', {
          sessionId: currentSession.current,
          cols: term.cols,
          rows: term.rows,
        });
      }
    });
    ro.observe(div);

    return () => {
      ro.disconnect();
      term.dispose();
      xtermRef.current    = null;
      fitAddonRef.current = null;
    };
  }, []); // runs once on mount — terminalRef.current is always set because the div is always in the DOM

  /* ── doJoin: emit terminal:join and fit/resize the PTY ── */
  function doJoin(sessionId) {
    const sock = getSocket();
    console.log('[terminal] sending terminal:join for', sessionId.slice(0, 8));
    sock.emit('terminal:join', { sessionId });
    // Two rAF cycles ensure the div is painted and measurable before fitting
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { fitAddonRef.current?.fit(); } catch (_) {}
      const term = xtermRef.current;
      if (term && sock.connected && term.cols > 0 && term.rows > 0) {
        sock.emit('terminal:resize', { sessionId, cols: term.cols, rows: term.rows });
      }
      term?.focus();
    }));
  }

  /* ── 2. Load sessions + set up socket listeners ── */
  useEffect(() => {
    loadSessions();
    const sock = getSocket();

    function onConnect() {
      console.log('[terminal] socket connected');
      setReconnecting(false);
      const pending = pendingJoinRef.current;
      if (pending) {
        // selectSession was called while disconnected — complete the join now
        pendingJoinRef.current = null;
        terminalStateRef.current = 'connecting';
        doJoin(pending);
      } else if (currentSession.current) {
        // Simple reconnect: xterm already has content, just re-join the room
        terminalStateRef.current = 'connecting';
        console.log('[terminal] sending terminal:reattach for', currentSession.current.slice(0, 8));
        sock.emit('terminal:reattach', { sessionId: currentSession.current });
        const term = xtermRef.current;
        if (term && term.cols > 0 && term.rows > 0) {
          sock.emit('terminal:resize', {
            sessionId: currentSession.current,
            cols: term.cols,
            rows: term.rows,
          });
        }
      }
    }

    function onDisconnect() {
      terminalStateRef.current = 'detached';
      setReconnecting(true);
      setReconnectTime(0);
    }

    function onData({ sessionId, data }) {
      if (sessionId === currentSession.current && xtermRef.current) {
        xtermRef.current.write(data);
      }
    }

    function onScrollback({ sessionId, data }) {
      if (sessionId === currentSession.current && xtermRef.current) {
        xtermRef.current.write(data);
      }
    }

    function onExit({ sessionId }) {
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (sessionId === currentSession.current) {
        currentSession.current = null;
        setActive(null);
      }
    }

    function onAiState({ sessionId, state }) {
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, aiState: state } : s));
    }

    function onSessionAttached({ sessionId }) {
      if (sessionId === currentSession.current) {
        terminalStateRef.current = 'attached';
        setSessionDead(false);
        if (xtermRef.current) {
          xtermRef.current.options.cursorBlink = true;
        }
      }
    }

    function onSessionDead({ sessionId }) {
      console.log('[terminal] terminal:session-dead received for', sessionId.slice(0, 8));
      if (sessionId === currentSession.current) {
        terminalStateRef.current = 'dead';
        setSessionDead(true);
        if (xtermRef.current) {
          xtermRef.current.options.cursorBlink = false;
          xtermRef.current.write('\r\n\x1b[31m[Session ended — Opus Command restarted. Open a new terminal to continue.]\x1b[0m\r\n');
        }
      }
    }

    sock.on('connect',                onConnect);
    sock.on('disconnect',             onDisconnect);
    sock.on('terminal:data',          onData);
    sock.on('terminal:scrollback',    onScrollback);
    sock.on('terminal:exit',          onExit);
    sock.on('terminal:ai-state',      onAiState);
    sock.on('terminal:session-attached', onSessionAttached);
    sock.on('terminal:session-dead',  onSessionDead);

    return () => {
      sock.off('connect',                onConnect);
      sock.off('disconnect',             onDisconnect);
      sock.off('terminal:data',          onData);
      sock.off('terminal:scrollback',    onScrollback);
      sock.off('terminal:exit',          onExit);
      sock.off('terminal:ai-state',      onAiState);
      sock.off('terminal:session-attached', onSessionAttached);
      sock.off('terminal:session-dead',  onSessionDead);

      if (currentSession.current) {
        sock.emit('terminal:leave', { sessionId: currentSession.current });
      }
    };
  }, [projectId]);

  /* ── Reconnect timer ── */
  useEffect(() => {
    if (!reconnecting) return;
    const t = setInterval(() => setReconnectTime(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [reconnecting]);

  async function loadSessions() {
    try {
      const res  = await fetch(`/api/projects/${projectId}/terminals`);
      const data = await res.json();
      const list = data.sessions || [];
      setSessions(list);
      if (list.length > 0) selectSession(list[0].id);
    } catch {
      addToast('Failed to load sessions.', 'error');
    }
  }

  /* ── Select (join) a session ── */
  function selectSession(sessionId) {
    const sock = getSocket();

    // Leave old room
    if (currentSession.current && currentSession.current !== sessionId) {
      sock.emit('terminal:leave', { sessionId: currentSession.current });
    }

    currentSession.current = sessionId;
    terminalStateRef.current = 'connecting';
    setActive(sessionId);
    setSessionDead(false);

    // Full reset: clears content AND resets terminal modes set by the previous session
    if (xtermRef.current) {
      xtermRef.current.reset();
      xtermRef.current.options.cursorBlink = true;
    }

    if (sock.connected) {
      doJoin(sessionId);
    } else {
      // Store for onConnect to pick up — overwrites any stale pending join
      pendingJoinRef.current = sessionId;
    }
  }

  /* ── Create a new session ── */
  async function createSession() {
    try {
      const res  = await fetch(`/api/projects/${projectId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.sessionId) {
        const newSession = { id: data.sessionId, name: data.name, active: true, aiState: 'none' };
        setSessions(prev => [...prev, newSession]);
        selectSession(data.sessionId);
      } else {
        addToast(data.error || 'Failed to create terminal.', 'error');
      }
    } catch (err) {
      addToast(`Failed to create terminal: ${err.message}`, 'error');
    }
  }

  function handleRename(sessionId, name) {
    fetch(`/api/projects/${projectId}/terminals/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ name }),
    }).then(() => setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name } : s)));
  }

  async function handleClose(sessionId) {
    await fetch(`/api/projects/${projectId}/terminals/${sessionId}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrfToken },
    });
    setSessions(prev => {
      const next = prev.filter(s => s.id !== sessionId);
      if (sessionId === activeSessionId && next.length > 0) selectSession(next[0].id);
      else if (next.length === 0) { currentSession.current = null; setActive(null); }
      return next;
    });
  }

  /* ── Render ── */
  return (
    <div className="terminal-page">

      {/* Tab bar — always visible */}
      <div className="terminal-tab-bar" role="tablist" aria-label="Terminal sessions">
        {sessions.map(s => (
          <TerminalTab
            key={s.id}
            session={s}
            active={s.id === activeSessionId}
            onSelect={selectSession}
            onRename={handleRename}
            onClose={handleClose}
          />
        ))}
        <button className="terminal-new-btn btn btn-ghost" onClick={createSession}>
          + New
        </button>
      </div>

      {/* Terminal container */}
      <div className="terminal-container" role="tabpanel">

        {/*
          The xterm div is ALWAYS in the DOM so xterm can open() on mount.
          Overlays sit on top when needed.
        */}
        <div ref={terminalRef} className="terminal-xterm" />

        {sessions.length === 0 && (
          <div className="terminal-empty-overlay">
            <p>No terminal sessions.</p>
            <button className="btn btn-primary" onClick={createSession}>New Terminal</button>
          </div>
        )}

        {sessionDead && (
          <div className="terminal-dead-overlay" role="alert">
            <div className="terminal-dead-content">
              <span className="terminal-dead-icon">&#9888;</span>
              <p className="terminal-dead-message">Session ended because Opus Command restarted.</p>
              <p className="terminal-dead-sub">Open a new terminal to continue.</p>
              <button className="btn btn-primary" onClick={createSession}>New Terminal</button>
            </div>
          </div>
        )}

        {reconnecting && (
          <div className="terminal-reconnect-overlay">
            <span className="terminal-reconnect-text">
              {reconnectTime > 5
                ? `Connection lost. Retrying… ${reconnectTime}s`
                : 'Reconnecting…'}
            </span>
          </div>
        )}
      </div>

      {/* Mobile toolbar */}
      <div className="terminal-mobile-toolbar">
        <span className="terminal-mobile-session-name">
          {sessions.find(s => s.id === activeSessionId)?.name || 'Terminal'}
        </span>
        <button className="btn btn-ghost" onClick={() => {
          navigator.clipboard.readText()
            .then(text => getSocket().emit('terminal:input', { sessionId: activeSessionId, data: text }))
            .catch(() => {});
        }}>Paste</button>
        <button className="btn btn-ghost" onClick={() => xtermRef.current?.focus()}>Keyboard</button>
      </div>
    </div>
  );
}
