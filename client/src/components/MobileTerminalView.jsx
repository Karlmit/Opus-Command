import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from '../lib/socket';
import './MobileTerminalView.css';

// Strip ANSI/VT escape sequences — CSI, OSC, charset, and 2-char escapes
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-9A-Za-z]|.)/g;

function stripAnsi(str) {
  return str.replace(ANSI_RE, '');
}

function rawToLines(raw) {
  return stripAnsi(raw)
    .replace(/\0/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');
}

const MAX_LINES = 5000;

export default function MobileTerminalView({ sessionId }) {
  const [lines, setLines] = useState([]);
  const [atBottom, setAtBottom] = useState(true);
  const [status, setStatus] = useState('loading'); // 'loading' | 'live' | 'dead'
  const [input, setInput] = useState('');

  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);
  // Holds the last partial (unterminated) line between data chunks
  const partialRef = useRef('');

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setAtBottom(atBottomRef.current);
  }

  // Append a raw PTY data chunk, accumulating partial lines
  const appendChunk = useCallback((data) => {
    const text = stripAnsi(data)
      .replace(/\0/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    const parts = (partialRef.current + text).split('\n');
    partialRef.current = parts.pop(); // last part may be incomplete

    if (parts.length === 0) return;

    setLines(prev => {
      const next = [...prev, ...parts];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  // Auto-scroll when lines change if we were already at the bottom
  useEffect(() => {
    if (atBottomRef.current) requestAnimationFrame(scrollToBottom);
  }, [lines, scrollToBottom]);

  useEffect(() => {
    if (!sessionId) return;
    partialRef.current = '';
    setLines([]);
    setStatus('loading');
    setAtBottom(true);
    atBottomRef.current = true;

    const sock = getSocket();

    function onScrollback({ sessionId: sid, data }) {
      if (sid !== sessionId) return;
      partialRef.current = '';
      const all = rawToLines(data);
      setLines(all.length > MAX_LINES ? all.slice(all.length - MAX_LINES) : all);
      setStatus('live');
      requestAnimationFrame(scrollToBottom);
    }

    function onData({ sessionId: sid, data }) {
      if (sid !== sessionId) return;
      appendChunk(data);
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
      sock.emit('terminal:join', { sessionId });
    }

    sock.on('terminal:scrollback', onScrollback);
    sock.on('terminal:data', onData);
    sock.on('terminal:session-attached', onAttached);
    sock.on('terminal:session-dead', onDead);
    sock.on('connect', onConnect);

    if (sock.connected) sock.emit('terminal:join', { sessionId });

    return () => {
      sock.emit('terminal:leave', { sessionId });
      sock.off('terminal:scrollback', onScrollback);
      sock.off('terminal:data', onData);
      sock.off('terminal:session-attached', onAttached);
      sock.off('terminal:session-dead', onDead);
      sock.off('connect', onConnect);
    };
  }, [sessionId, appendChunk, scrollToBottom]);

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

  return (
    <div className="mtv">
      {/* Output log */}
      <div className="mtv-output" ref={scrollRef} onScroll={handleScroll}>
        {status === 'loading' && <div className="mtv-notice">Connecting…</div>}
        {status === 'dead' && <div className="mtv-notice mtv-notice-dead">Session ended</div>}
        {lines.map((line, i) => (
          <div key={i} className="mtv-line">{line || ' '}</div>
        ))}
        {/* Flush partial line as a dimmed preview */}
        {partialRef.current && (
          <div className="mtv-line mtv-line-partial">{partialRef.current}</div>
        )}
      </div>

      {/* Jump to bottom */}
      {!atBottom && (
        <button
          className="mtv-jump"
          onClick={() => { atBottomRef.current = true; setAtBottom(true); scrollToBottom(); }}
        >
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
