import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import '@xterm/xterm/css/xterm.css';
import './Terminal.css';

let socket = null;

function getSocket() {
  if (!socket || socket.disconnected) {
    socket = io({ autoConnect: true, reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: 20 });
  }
  return socket;
}

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

  const aiState = session.aiState;

  return (
    <div
      className={`terminal-tab${active ? ' active' : ''}${aiState !== 'none' ? ` ai-${aiState}` : ''}`}
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

      {aiState === 'waiting' && (
        <span className="badge-ai terminal-tab-ai-badge" aria-live="polite" aria-atomic="true">
          Waiting
        </span>
      )}

      {active && !renaming && (
        <button
          className={`terminal-tab-close${confirmClose ? ' confirming' : ''}`}
          onClick={handleClose}
          title={confirmClose ? 'Click again to kill' : 'Close'}
          aria-label={confirmClose ? 'Confirm kill' : 'Close session'}
        >
          {confirmClose ? 'Kill?' : '×'}
        </button>
      )}
    </div>
  );
}

export default function TerminalPage() {
  const { id: projectId } = useParams();
  const { csrfToken } = useAuth();
  const { addToast } = useToast();

  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectTime, setReconnectTime] = useState(0);

  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const currentSessionRef = useRef(null);

  // Initialize xterm
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#1E2024',
        foreground: '#E8EAED',
        cursor: '#3B82F6',
        selectionBackground: 'rgba(59,130,246,0.30)',
      },
      fontFamily: "'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace",
      fontSize: 14,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const linksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(linksAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Forward keyboard input to socket
    term.onData(data => {
      const sock = getSocket();
      if (currentSessionRef.current && sock.connected) {
        sock.emit('terminal:input', { sessionId: currentSessionRef.current, data });
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (currentSessionRef.current) {
        const sock = getSocket();
        sock.emit('terminal:resize', {
          sessionId: currentSessionRef.current,
          cols: term.cols,
          rows: term.rows,
        });
      }
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
    };
  }, []);

  // Load sessions and set up socket
  useEffect(() => {
    loadSessions();
    const sock = setupSocket();
    return () => {
      if (currentSessionRef.current) {
        sock.emit('terminal:leave', { sessionId: currentSessionRef.current });
      }
    };
  }, [projectId]);

  async function loadSessions() {
    try {
      const res = await fetch(`/api/projects/${projectId}/terminals`);
      const data = await res.json();
      setSessions(data.sessions || []);
      // Auto-select first active session
      const first = data.sessions?.[0];
      if (first && !activeSessionId) {
        selectSession(first.id);
      }
    } catch {
      addToast('Failed to load terminal sessions.', 'error');
    }
  }

  function setupSocket() {
    const sock = getSocket();

    sock.on('connect', () => {
      setConnected(true);
      setReconnecting(false);
      // Reattach to current session
      if (currentSessionRef.current) {
        sock.emit('terminal:join', { sessionId: currentSessionRef.current });
      }
    });

    sock.on('disconnect', () => {
      setConnected(false);
      setReconnecting(true);
      setReconnectTime(0);
    });

    sock.on('terminal:data', ({ sessionId, data }) => {
      if (sessionId === currentSessionRef.current && xtermRef.current) {
        xtermRef.current.write(data);
      }
    });

    sock.on('terminal:scrollback', ({ sessionId, data }) => {
      if (sessionId === currentSessionRef.current && xtermRef.current) {
        xtermRef.current.clear();
        xtermRef.current.write(data);
      }
    });

    sock.on('terminal:exit', ({ sessionId }) => {
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (sessionId === currentSessionRef.current) {
        currentSessionRef.current = null;
        setActiveSessionId(null);
      }
    });

    sock.on('terminal:ai-state', ({ sessionId, state }) => {
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, aiState: state } : s));
    });

    sock.on('project:status', ({ id, status }) => {
      // Project status changed — update terminal count if needed
    });

    return sock;
  }

  // Reconnect timer
  useEffect(() => {
    if (!reconnecting) return;
    const interval = setInterval(() => setReconnectTime(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [reconnecting]);

  function selectSession(sessionId) {
    const sock = getSocket();

    // Leave current session room
    if (currentSessionRef.current && currentSessionRef.current !== sessionId) {
      sock.emit('terminal:leave', { sessionId: currentSessionRef.current });
    }

    currentSessionRef.current = sessionId;
    setActiveSessionId(sessionId);

    // Join new session room
    sock.emit('terminal:join', { sessionId });

    // Resize after selection
    setTimeout(() => {
      fitAddonRef.current?.fit();
      if (xtermRef.current && sessionId) {
        sock.emit('terminal:resize', {
          sessionId,
          cols: xtermRef.current.cols,
          rows: xtermRef.current.rows,
        });
      }
    }, 50);
  }

  async function createSession() {
    try {
      const res = await fetch(`/api/projects/${projectId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.sessionId) {
        setSessions(prev => [...prev, {
          id: data.sessionId,
          name: data.name,
          active: true,
          aiState: 'none',
        }]);
        selectSession(data.sessionId);
        xtermRef.current?.clear();
        xtermRef.current?.focus();
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
    }).then(() => {
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name } : s));
    });
  }

  async function handleClose(sessionId) {
    await fetch(`/api/projects/${projectId}/terminals/${sessionId}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrfToken },
    });
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (sessionId === activeSessionId) {
      const remaining = sessions.filter(s => s.id !== sessionId);
      if (remaining.length > 0) selectSession(remaining[0].id);
      else setActiveSessionId(null);
    }
  }

  return (
    <div className="terminal-page">
      {/* Tab bar */}
      <div className="terminal-tab-bar" role="tablist" aria-label="Terminal sessions">
        {sessions.map(session => (
          <TerminalTab
            key={session.id}
            session={session}
            active={session.id === activeSessionId}
            onSelect={selectSession}
            onRename={handleRename}
            onClose={handleClose}
          />
        ))}
        <button className="terminal-new-btn btn btn-ghost" onClick={createSession} title="New terminal">
          + New
        </button>
      </div>

      {/* Terminal panel */}
      <div className="terminal-container" role="tabpanel">
        {sessions.length === 0 ? (
          <div className="terminal-empty">
            <p>No terminal sessions. Open a new terminal to start.</p>
            <button className="btn btn-primary" onClick={createSession}>New Terminal</button>
          </div>
        ) : (
          <div
            ref={terminalRef}
            className="terminal-xterm"
            style={{ display: activeSessionId ? 'block' : 'none' }}
          />
        )}

        {/* Reconnect overlay */}
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
          navigator.clipboard.readText().then(text => {
            const sock = getSocket();
            if (activeSessionId) sock.emit('terminal:input', { sessionId: activeSessionId, data: text });
          }).catch(() => {});
        }}>Paste</button>
        <button className="btn btn-ghost" onClick={() => xtermRef.current?.focus()}>
          Keyboard
        </button>
        <button className="btn btn-ghost" onClick={() => setSessions(s => [...s])}>
          Sessions
        </button>
      </div>
    </div>
  );
}
