import { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { ProjectAvatar } from '../components/ProjectsSidebar';
import { useMobileUI } from '../context/MobileUIContext';
import { useDevice } from '../context/DeviceContext';
import { getSocket } from '../lib/socket';
import { TERMINAL_ANSI } from '../lib/themes';
import MobileTerminalView, { MobileTermTabs } from '../components/MobileTerminalView';
import SyntaxHighlightedEditor from '../components/SyntaxHighlightedEditor';
import { FilePlainIcon, FileDocIcon, FileImageIcon, FolderIcon, FolderOpenIcon } from '../components/FileTreeIcons';
import GitPage from './Git';
import '@xterm/xterm/css/xterm.css';
import './ProjectCockpit.css';

/* ── File tree ─────────────────────────────────── */
const FILE_COLORS = {
  // Web
  js:   '#f0db4f', mjs: '#f0db4f', cjs: '#f0db4f',
  ts:   '#3178c6',
  jsx:  '#61dafb', tsx: '#61dafb',
  css:  '#6699ff', scss: '#cc6699', sass: '#cc6699',
  html: '#e34c26', htm: '#e34c26',
  // Data / config
  json: '#f5a623', jsonc: '#f5a623',
  yaml: '#cb171e', yml: '#cb171e',
  toml: '#9c4221', ini: '#9c4221', env: '#5bb974',
  xml:  '#d97706',
  // Docs
  md: '#4b9eff', mdx: '#4b9eff', txt: '#aaa',
  // Scripts
  sh: '#4eaa25', bash: '#4eaa25', zsh: '#4eaa25', ps1: '#0178d4',
  // Languages
  py: '#3572A5', rb: '#cc342d', go: '#00add8', rs: '#ce4a2e',
  java: '#b07219', kt: '#A97BFF', swift: '#F05138',
  c: '#55a1b7', cpp: '#f34b7d', h: '#55a1b7',
  cs: '#178600', php: '#4F5D95',
  sql: '#e38c00',
  // Images (shown but not editable)
  png: '#b088f0', jpg: '#b088f0', jpeg: '#b088f0',
  gif: '#b088f0', svg: '#ffb13b', webp: '#b088f0',
};

const DEFAULT_TERMINAL_COMMANDS = [
  {
    id: 'codex',
    displayName: 'Codex',
    description: 'Launch Codex CLI with Opus-managed sandbox and approval bypass flags.',
    commands: ['codex --dangerously-bypass-approvals-and-sandbox'],
  },
  {
    id: 'claude',
    displayName: 'Claude',
    description: 'Launch Claude Code with Opus-managed permission bypass flags.',
    commands: ['IS_SANDBOX=1 claude --dangerously-skip-permissions'],
  },
];

/* Context menu rendered to document.body so it escapes the file-tree's
   backdrop-filter / overflow:hidden, and clamped to stay on-screen. */
function ContextMenuPortal({ x, y, className, children, ...rest }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x, top = y;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [x, y]);
  return createPortal(
    <div ref={ref} className={className} style={{ position: 'fixed', left: pos.left, top: pos.top }} role="menu" {...rest}>
      {children}
    </div>,
    document.body
  );
}

// Image extensions get the "picture" icon; everything else gets a file icon
// tinted by FILE_COLORS (known type → lined document icon, unknown → plain file).
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif']);

function FileIcon({ name, isDir, open }) {
  if (isDir) {
    // Folders keep the icon set's own amber palette; .fi-dir drives the hover glow.
    const Folder = open ? FolderOpenIcon : FolderIcon;
    return <Folder className="fi-icon fi-dir" />;
  }
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const color = FILE_COLORS[ext] || '#9aa0aa';
  let Icon = FilePlainIcon;
  if (IMAGE_EXTS.has(ext)) Icon = FileImageIcon;
  else if (FILE_COLORS[ext]) Icon = FileDocIcon;
  // currentColor (set via `color`) tints the file frame and feeds the hover glow.
  return <Icon className="fi-icon fi-file" style={{ color }} />;
}

function NewFileIcon() {
  return (
    <svg className="ft-action-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4 1.5A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V6.25L8.75 1.5H4zm4.25 1.25L12.25 6H9a.75.75 0 0 1-.75-.75V2.75zM8 8a.5.5 0 0 1 .5.5V10H10a.5.5 0 0 1 0 1H8.5v1.5a.5.5 0 0 1-1 0V11H6a.5.5 0 0 1 0-1h1.5V8.5A.5.5 0 0 1 8 8z"/>
    </svg>
  );
}

function NewFolderIcon() {
  return (
    <svg className="ft-action-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.2c.4 0 .78.16 1.06.44L8.32 4H13a1.5 1.5 0 0 1 1.5 1.5V12A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V4zm6 3.5A.5.5 0 0 0 7 8v1.5H5.5a.5.5 0 0 0 0 1H7V12a.5.5 0 0 0 1 0v-1.5h1.5a.5.5 0 0 0 0-1H8V8a.5.5 0 0 0-.5-.5z"/>
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="ft-action-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5a.75.75 0 0 1 .53.22l3 3a.75.75 0 1 1-1.06 1.06L8.75 4.56V10a.75.75 0 0 1-1.5 0V4.56L5.53 5.78a.75.75 0 0 1-1.06-1.06l3-3A.75.75 0 0 1 8 1.5zM3 10.5a.75.75 0 0 1 .75.75v1.25c0 .14.11.25.25.25h8a.25.25 0 0 0 .25-.25v-1.25a.75.75 0 0 1 1.5 0v1.25A1.75 1.75 0 0 1 12 14.25H4a1.75 1.75 0 0 1-1.75-1.75v-1.25A.75.75 0 0 1 3 10.5z"/>
    </svg>
  );
}

function FileNode({
  node, depth, onOpenFile, activeFilePath,
  onOpenContextMenu, onOpenRenameDialog, selectedPaths, onSelectNode, onContextSelect,
  expandedPaths, onToggleFolder,
}) {
  const isDir = node.type === 'dir';
  const isActive = activeFilePath === node.path;
  const isMarked = selectedPaths.has(node.path);
  const open = isDir && expandedPaths.has(node.path);

  function handleRowClick(e) {
    // Ctrl/Cmd toggles a single item; Shift extends a range from the anchor.
    const ctrl = e.metaKey || e.ctrlKey;
    if (ctrl || e.shiftKey) {
      onSelectNode(node, { ctrl, shift: e.shiftKey });
      return;
    }
    const wasSoleSelection = isMarked && selectedPaths.size === 1;
    onSelectNode(node, {});
    if (isDir) {
      // A second plain click on an already-selected folder toggles it open/closed.
      if (wasSoleSelection) onToggleFolder(node.path);
      return;
    }
    onOpenFile(node);
  }

  return (
    <div className="file-node-wrap">
      <div
        className={`file-node${isActive ? ' active' : ''}${isMarked ? ' marked' : ''}`}
        style={{ paddingLeft: depth * 16 + 6 }}
        tabIndex={0}
        onClick={handleRowClick}
        onContextMenu={e => {
          e.preventDefault();
          e.stopPropagation();
          onContextSelect(node);
          onOpenContextMenu(node, e.clientX, e.clientY);
        }}
        onKeyDown={e => {
          if (e.key === 'F2') {
            e.preventDefault();
            onOpenRenameDialog(node);
          }
        }}
      >
        {isDir && (
          <span
            className={`fn-chevron${open ? ' open' : ''}`}
            onClick={e => {
              e.stopPropagation();
              onToggleFolder(node.path);
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M3 2l4 3-4 3V2z"/>
            </svg>
          </span>
        )}
        {!isDir && <span className="fn-chevron-gap" />}
        <FileIcon name={node.name} isDir={isDir} open={open} />
        <span className="file-node-name">{node.name}</span>
      </div>

      {isDir && open && (
        <div className="file-node-children">
          {node.children?.length === 0 && (
            <div className="file-node-empty" style={{ paddingLeft: (depth + 1) * 16 + 22 }}>
              Empty
            </div>
          )}
          {node.children?.map(c => (
            <FileNode key={c.path} node={c} depth={depth + 1}
              onOpenFile={onOpenFile}
              activeFilePath={activeFilePath}
              onOpenContextMenu={onOpenContextMenu}
              onOpenRenameDialog={onOpenRenameDialog}
              selectedPaths={selectedPaths}
              onSelectNode={onSelectNode}
              onContextSelect={onContextSelect}
              expandedPaths={expandedPaths}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Run work when the main thread is idle so it never competes with terminal
// input. Falls back to setTimeout where requestIdleCallback is unavailable.
function runWhenIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn(), { timeout: 2000 });
  } else {
    setTimeout(fn, 0);
  }
}

/* ── Terminal instance ─────────────────────────── */
let _xtermInstanceCounter = 0;

// Build the xterm theme from the active CSS theme tokens. The base colors come
// from `--color-terminal-*` custom properties so the terminal tracks whatever
// theme is on <html>. ANSI (16-color) palettes are applied for Catppuccin
// flavors only; Opus themes omit them so xterm keeps its default ANSI colors.
// Reassigning `term.options.theme` resets any unspecified ANSI color back to
// xterm's defaults, so switching Catppuccin -> Opus restores the original look.
function buildTerminalTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, fallback) => cs.getPropertyValue(n).trim() || fallback;
  const bg = v('--color-terminal-bg', '#1E2024');
  const base = {
    background: bg,
    foreground: v('--color-terminal-text', '#E8EAED'),
    cursor: v('--color-terminal-cursor', '#3B82F6'),
    cursorAccent: bg,
    selectionBackground: v('--color-terminal-selection', 'rgba(59,130,246,0.30)'),
    scrollbarSliderBackground: v('--color-border-strong', 'rgba(255,255,255,0.14)'),
    scrollbarSliderHoverBackground: 'rgba(255,255,255,0.20)',
    scrollbarSliderActiveBackground: 'rgba(255,255,255,0.30)',
  };
  const ansi = TERMINAL_ANSI[document.documentElement.getAttribute('data-theme')];
  return ansi ? { ...base, ...ansi } : base;
}

function TerminalInstance({
  sessionId, active, termRefs, pendingScrollback,
  onScrollbackApplied, onTerminalDisposed,
  projectId, csrfToken, addToast, lastInputRef,
}) {
  const divRef = useRef(null);
  const activeStateRef = useRef(active);

  useEffect(() => {
    activeStateRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!divRef.current || termRefs.current[sessionId]) return;
    let cancelled = false;
    const instanceId = ++_xtermInstanceCounter;
    console.log(`[xterm:${instanceId}] Opening for session ${sessionId.slice(0,8)}`);

    const term = new XTerm({
      fontFamily: '"Cascadia Mono", monospace',
      fontSize: 16,
      fontWeight: 400,
      fontWeightBold: 700,
      lineHeight: 1.0,
      letterSpacing: 0,
      theme: buildTerminalTheme(),
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowTransparency: false,
    });

    // Recolor this terminal live when the app theme changes (no reload needed).
    const themeObserver = new MutationObserver(() => {
      term.options.theme = buildTerminalTheme();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    let ro = null;
    let fitFrame = null;
    let lastEmittedSize = null;
    let pasteEl = null;
    const isDeviceMobile = () => document.body.classList.contains('mobile-device');
    const onWinResize = () => {
      scheduleFit();
    };
    // Re-fit when the window/tab regains focus. After a hard refresh (Ctrl+Shift+R)
    // the first fit can overshoot — measured before fonts/layout settle — leaving
    // the PTY wider than the viewport so lines wrap off-screen. Refitting on
    // return corrects the column count.
    const onVisible = () => { if (!document.hidden) scheduleFit(); };
    const doResizeEmit = () => {
      const sock = getSocket();
      if (!activeStateRef.current || isDeviceMobile()) return;
      if (!term.cols || !term.rows || !sock.connected) return;

      const nextSize = `${term.cols}x${term.rows}`;
      if (lastEmittedSize === nextSize) return;
      lastEmittedSize = nextSize;
      sock.emit('terminal:resize', { sessionId, cols: term.cols, rows: term.rows });
    };
    // Fit, but keep the viewport pinned to the bottom if it already was.
    // Without this, a reflow on resize scrolls the view up into the scrollback.
    const fitAndKeepBottom = () => {
      const buf = term.buffer?.active;
      const wasBottom = !buf || buf.viewportY >= buf.baseY;
      try { fit.fit(); } catch (_) {}
      if (wasBottom) { try { term.scrollToBottom(); } catch (_) {} }
    };
    const runFit = () => {
      fitFrame = null;
      if (!activeStateRef.current || cancelled || !divRef.current) return;
      fitAndKeepBottom();
      doResizeEmit();
    };
    const scheduleFit = () => {
      if (fitFrame || !activeStateRef.current) return;
      fitFrame = requestAnimationFrame(runFit);
    };
    const fitActive = () => {
      if (!activeStateRef.current) return;
      fitAndKeepBottom();
      doResizeEmit();
    };
    // Force xterm to re-measure the glyph cell size, then fit. Used as a safety
    // net in case the first measurement happened with a fallback font (which is
    // narrower → too many columns → PTY wider than the viewport).
    const forceRemeasureFit = () => {
      if (cancelled || !divRef.current) return;
      try {
        const fam = term.options.fontFamily;
        term.options.fontFamily = 'monospace';
        term.options.fontFamily = fam;
      } catch (_) {}
      fitActive();
    };
    const getSize = () => {
      if (!activeStateRef.current) return null;
      return term.cols ? { cols: term.cols, rows: term.rows } : null;
    };
    const emitInput = data => {
      const sock = getSocket();
      if (lastInputRef) lastInputRef.current = Date.now();
      if (sock.connected) {
        sock.emit('terminal:input', { sessionId, data });
      }
    };
    const emitResize = () => {
      doResizeEmit();
    };

    // ── Clipboard copy ───────────────────────────────────────────────────────
    // navigator.clipboard only exists in secure contexts (HTTPS / localhost).
    // Self-hosted over plain HTTP on a LAN IP, it's undefined — so writeText is a
    // silent no-op. Fall back to a hidden textarea + execCommand('copy'), which
    // works on insecure origins too.
    const copyText = (text) => {
      if (!text) return;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      } else {
        fallbackCopy(text);
      }
    };
    const fallbackCopy = (text) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) {}
      // execCommand stole focus via the textarea — hand it back to the terminal.
      try { term.focus(); } catch (_) {}
    };

    // Remember the most recent non-empty selection. Apps like Claude Code repaint
    // constantly, and xterm drops the visible selection whenever a write touches
    // the selected rows — so the live selection is usually gone by the time the
    // user presses Ctrl+C. Capturing it here keeps copy working regardless.
    let lastSelection = '';
    term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel) lastSelection = sel;
    });

    // Copy-on-select: read the selection synchronously on mouseup — this runs
    // *before* the app's next repaint clears it, and inside a real user gesture
    // so execCommand('copy') is permitted on insecure (HTTP) origins. With mouse
    // reporting on (Claude Code/Codex), selecting requires holding Shift; this
    // then makes that selection actually land on the clipboard.
    const onMouseUp = () => {
      const sel = term.getSelection();
      if (sel) { lastSelection = sel; copyText(sel); }
    };

    // ── Clipboard paste ──────────────────────────────────────────────────────
    // Text paste is handled by xterm's own native browser 'paste' event (works
    // on insecure origins, and is bracketed-paste aware). We only intercept the
    // Ctrl+V *key* to suppress the raw ^V that CLIs like Claude Code misread as
    // "paste image". Images are caught from the same paste event and uploaded,
    // with their workspace path pasted into the terminal as a bonus.
    const pasteImageBlob = async (blob, mime) => {
      try {
        const ext = (mime.split('/')[1] || 'png').replace('+xml', '');
        const fileName = `pasted-${Date.now()}.${ext}`;
        // Best-effort: keep pasted images tidy in their own folder.
        await fetch(`/api/projects/${projectId}/files/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ filePath: '.opus-pastes', type: 'dir' }),
        }).catch(() => {});
        const fd = new FormData();
        fd.append('files', new File([blob], fileName, { type: mime }));
        // targetPath goes in the query string, not the form body: multer reads
        // the upload destination before the body fields are parsed.
        const r = await fetch(
          `/api/projects/${projectId}/files/upload?targetPath=${encodeURIComponent('.opus-pastes')}`,
          {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfToken },
            body: fd,
          },
        );
        if (!r.ok) throw new Error('upload failed');
        const wsPath = `/workspace/.opus-pastes/${fileName}`;
        emitInput(`'${wsPath.replace(/'/g, "'\\''")}' `);
        addToast?.('Pasted image path into terminal.');
      } catch (_) {
        addToast?.('Could not paste image.', 'error');
      }
    };
    // Native paste event: hijack images, let xterm handle text normally.
    const onPasteCapture = (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      // Prefer text when present — only hijack when the clipboard is image-only.
      if (Array.from(cd.types || []).includes('text/plain')) return;
      const items = cd.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            e.stopPropagation();
            pasteImageBlob(blob, item.type);
            return;
          }
        }
      }
      // No image — do nothing; xterm's own paste handler inserts the text.
    };

    // open() is called inside fonts.ready so glyph widths are measured with
    // the correct font. If we call term.open() before fonts load (e.g. on a
    // hard refresh where fonts must be re-downloaded), xterm measures character
    // width using the fallback monospace font, which is narrower than Cascadia
    // Mono. FitAddon then calculates too many columns and text overflows the
    // container. Deferring until fonts.ready guarantees correct measurements.
    //
    // The tradeoff: the server can respond to terminal:join with scrollback
    // before open() runs. onScrollback stores that data in pendingScrollback
    // and we replay it immediately after open() below.
    const open = () => {
      if (cancelled || !divRef.current) return;

      term.open(divRef.current);

      term.onData(data => {
        emitInput(data);
      });

      // Catch image pastes before xterm; text pastes fall through to xterm.
      pasteEl = divRef.current;
      pasteEl.addEventListener('paste', onPasteCapture, true);
      // Copy-on-select (see onMouseUp). Bubble phase, after xterm finalises it.
      pasteEl.addEventListener('mouseup', onMouseUp);

      // ── Keyboard ergonomics ────────────────────────────────────────────────
      // Returning false stops xterm from sending the key to the PTY (but does
      // NOT preventDefault — so the browser's native paste still fires for ^V).
      term.attachCustomKeyEventHandler(e => {
        if (e.type !== 'keydown') return true;
        const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;

        // Ctrl+C — if there's a (recent) selection, copy it and unmark instead
        // of sending SIGINT. lastSelection survives repaints that clear the
        // visible selection. With nothing selected, fall through to SIGINT.
        if (ctrl && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
          const sel = term.getSelection() || lastSelection;
          if (sel) {
            copyText(sel);
            term.clearSelection();
            lastSelection = '';
            return false;
          }
          return true;
        }

        // Ctrl+Shift+C — explicit copy of the selection.
        if (e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
          const sel = term.getSelection() || lastSelection;
          if (sel) {
            copyText(sel);
            term.clearSelection();
            lastSelection = '';
            return false;
          }
          return true;
        }

        // Ctrl+V / Ctrl+Shift+V — suppress the raw ^V; the native paste event
        // (handled by xterm for text, onPasteCapture for images) does the work.
        if (ctrl && (e.key === 'v' || e.key === 'V')) {
          return false;
        }

        // Word deletion: Ctrl+Backspace kills the previous word (^W),
        // Ctrl+Delete kills the next word (Alt+d / ESC d).
        if (ctrl && e.key === 'Backspace') { emitInput('\x17'); lastSelection = ''; return false; }
        if (ctrl && e.key === 'Delete')    { emitInput('\x1bd'); lastSelection = ''; return false; }

        // Any ordinary typing means the user has moved on — forget the
        // remembered selection so a later lone Ctrl+C interrupts as expected.
        if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.key.length === 1 || e.key === 'Enter')) {
          lastSelection = '';
        }

        return true;
      });

      // Register ref so live terminal:data events can write to the terminal.
      termRefs.current[sessionId] = {
        write:   d  => term.write(d),
        clear:   () => term.clear(),
        reset:   () => term.reset(),
        focus:   () => term.focus(),
        fit:     fitActive,
        getSize,
        emitResize,
      };

      // Replays the buffered scrollback that the server captured at the real PTY
      // width. This MUST run after the terminal has been fitted to its true size:
      // a fresh xterm defaults to 80 cols, and writing wide history into an 80-col
      // grid and then reflowing it up to the real width mangles every wrapped line.
      const applyPendingScrollback = () => {
        const pending = pendingScrollback?.current?.[sessionId];
        if (pending === undefined) return;
        delete pendingScrollback.current[sessionId];
        term.reset();
        term.write(pending);
        try { term.scrollToBottom(); } catch (_) {}
        onScrollbackApplied?.(sessionId);
      };

      // Double rAF: ensures the flex layout has fully settled before FitAddon
      // measures the container. A single rAF is not enough after a hard refresh
      // because the browser hasn't finished computing flex dimensions yet.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (cancelled || !divRef.current) return;
        fitActive();
        // Now that the grid is the correct width, replay history into it.
        applyPendingScrollback();
        // Corrective re-fit once fonts/layout have fully settled, so an early
        // overshoot doesn't leave the PTY wider than the visible area.
        setTimeout(() => {
          if (cancelled || !divRef.current) return;
          forceRemeasureFit();
          try { term.scrollToBottom(); } catch (_) {}
        }, 350);
        ro = new ResizeObserver(scheduleFit);
        ro.observe(divRef.current);
        const parent = divRef.current?.parentElement;
        if (parent) ro.observe(parent);
        window.addEventListener('resize', onWinResize);
        window.addEventListener('focus', onVisible);
        document.addEventListener('visibilitychange', onVisible);
      }));
    };

    // Open only once the *actual* terminal font is loaded — not merely
    // document.fonts.ready, which can resolve before "Cascadia Mono" is ever
    // requested (e.g. arriving from the Settings page, which never uses it).
    // Measuring with the fallback font makes FitAddon overshoot the column
    // count, leaving the PTY wider than the viewport.
    const FONT_SPEC = '16px "Cascadia Mono"';
    const fontsApi = (typeof document !== 'undefined') ? document.fonts : null;
    if (fontsApi?.load) {
      fontsApi.load(FONT_SPEC).then(
        () => { if (!cancelled) open(); },
        () => { if (!cancelled) open(); },
      );
    } else if (fontsApi?.ready) {
      fontsApi.ready.then(open);
    } else {
      open();
    }

    return () => {
      cancelled = true;
      if (fitFrame) cancelAnimationFrame(fitFrame);
      console.log(`[xterm:${instanceId}] Disposing for session ${sessionId.slice(0,8)}`);
      themeObserver.disconnect();
      ro?.disconnect();
      window.removeEventListener('resize', onWinResize);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      pasteEl?.removeEventListener('paste', onPasteCapture, true);
      pasteEl?.removeEventListener('mouseup', onMouseUp);
      term.dispose();
      delete termRefs.current[sessionId];
      onTerminalDisposed?.(sessionId);
    };
  }, []);

  // Refit + focus when tab becomes active
  useEffect(() => {
    if (!active) return;
    const refit = () => {
      const ref = termRefs.current[sessionId];
      if (!ref) return;
      ref.fit();
      ref.emitResize?.();
    };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      refit();
      termRefs.current[sessionId]?.focus();
    }));
    // Corrective re-fit after layout settles (e.g. switching back from a panel
    // or returning to a freshly-refreshed tab) so the PTY width matches what's
    // actually visible.
    const t = setTimeout(refit, 300);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <div
      ref={divRef}
      className="terminal-instance"
      // visibility:hidden keeps layout dimensions intact.
      // display:none → FitAddon measures 0×0 → squished rendering when re-shown.
      style={{ visibility: active ? 'visible' : 'hidden' }}
    />
  );
}

/* ── Workspace volumes section ─────────────────── */
const SENSITIVE_HOST_PREFIXES = ['/root', '/etc', '/var/run', '/run/secrets', '/proc', '/sys', '/boot', '/home'];
function hostPathLooksSensitive(p) {
  const s = String(p || '');
  return SENSITIVE_HOST_PREFIXES.some(prefix => s === prefix || s.startsWith(prefix + '/'));
}

const BLANK_VOLUME = { hostPath: '', containerPath: '', readOnly: true, description: '' };

function VolumesSection({ projectId, project, csrfToken, addToast }) {
  const [volumes, setVolumes] = useState([]);
  const [applied, setApplied] = useState(true);
  const [form, setForm] = useState(null);     // draft being added/edited, or null
  const [editIndex, setEditIndex] = useState(null); // index being edited, null = adding new
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const running = project?.status === 'running';

  async function load() {
    try {
      const r = await fetch(`/api/projects/${projectId}/volumes`);
      const d = await r.json();
      setVolumes(d.volumes || []);
      setApplied(d.applied !== false);
    } catch (_) {}
  }
  useEffect(() => { load(); }, [projectId]);

  async function persist(next) {
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/volumes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ volumes: next }),
      });
      const d = await r.json();
      if (!d.success) { addToast(d.error || 'Failed to save volumes.', 'error'); return false; }
      setVolumes(d.volumes || []);
      setApplied(!d.restartRequired);
      addToast(d.message || 'Volumes saved.');
      return true;
    } catch (e) {
      addToast(e.message || 'Failed to save volumes.', 'error');
      return false;
    } finally { setBusy(false); }
  }

  function startAdd() { setForm({ ...BLANK_VOLUME }); setEditIndex(null); }
  function startEdit(i) { setForm({ ...volumes[i] }); setEditIndex(i); }
  function cancelForm() { setForm(null); setEditIndex(null); }

  async function submitForm(e) {
    e.preventDefault();
    const hostPath = form.hostPath.trim();
    const containerPath = form.containerPath.trim();
    if (!hostPath || !containerPath) { addToast('Host path and container path are required.', 'error'); return; }
    const entry = { hostPath, containerPath, readOnly: !!form.readOnly, description: form.description.trim() };
    const next = volumes.map(v => ({ hostPath: v.hostPath, containerPath: v.containerPath, readOnly: v.readOnly, description: v.description || '' }));
    if (editIndex === null) next.push(entry);
    else next[editIndex] = entry;
    if (await persist(next)) cancelForm();
  }

  async function removeVolume(i) {
    if (!confirm(`Remove mount ${volumes[i].containerPath}?`)) return;
    const next = volumes.filter((_, idx) => idx !== i)
      .map(v => ({ hostPath: v.hostPath, containerPath: v.containerPath, readOnly: v.readOnly, description: v.description || '' }));
    await persist(next);
  }

  async function restartWithVolumes() {
    setRestarting(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/lifecycle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ action: 'recreate' }),
      });
      const d = await r.json();
      if (!d.success) addToast(d.error || 'Restart failed.', 'error');
      else { addToast('Workspace recreated with new volumes.'); setApplied(true); }
    } catch (e) { addToast(e.message, 'error'); }
    finally { setRestarting(false); load(); }
  }

  const formSensitive = form && hostPathLooksSensitive(form.hostPath);

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <div className="panel-section-title">WORKSPACE VOLUMES</div>
        {!form && <button className="btn btn-ghost" onClick={startAdd} disabled={busy}>Add Volume</button>}
      </div>
      <p className="panel-hint">
        Mount extra host paths into this workspace. Mounts default to read-only and
        apply when the workspace is recreated.
      </p>

      {running && !applied && (
        <div className="vol-warn">
          <div>Changing volumes requires recreating/restarting the workspace.</div>
          <button className="btn btn-primary" onClick={restartWithVolumes} disabled={restarting}>
            {restarting ? 'Restarting…' : 'Restart workspace with new volumes'}
          </button>
        </div>
      )}

      {volumes.length === 0 && !form && <p className="panel-hint">No extra volumes mounted.</p>}

      {volumes.map((v, i) => (
        <div key={i} className="vol-row">
          <div className="vol-row-main">
            <div className="vol-paths">
              <code>{v.hostPath}</code>
              <span className="vol-arrow">→</span>
              <code>{v.containerPath}</code>
              <span className={`vol-mode ${v.readOnly ? 'ro' : 'rw'}`}>{v.readOnly ? 'ro' : 'rw'}</span>
            </div>
            {v.description && <div className="vol-desc">{v.description}</div>}
            {(v.sensitive || hostPathLooksSensitive(v.hostPath)) && (
              <div className="vol-sensitive">⚠ Sensitive host path — mounted contents are exposed inside the workspace.</div>
            )}
          </div>
          <div className="vol-row-actions">
            <button className="btn btn-ghost" onClick={() => startEdit(i)} disabled={busy}>Edit</button>
            <button className="btn btn-ghost ws-danger" onClick={() => removeVolume(i)} disabled={busy}>Remove</button>
          </div>
        </div>
      ))}

      {form && (
        <form className="vol-form" onSubmit={submitForm}>
          <label className="vol-field">
            <span>Host path</span>
            <input className="input" value={form.hostPath} placeholder="/root/opus-unraid-nopass"
              onChange={e => setForm(f => ({ ...f, hostPath: e.target.value }))} autoFocus />
          </label>
          <label className="vol-field">
            <span>Container path</span>
            <input className="input" value={form.containerPath} placeholder="/run/secrets/opus-unraid-ssh-key"
              onChange={e => setForm(f => ({ ...f, containerPath: e.target.value }))} />
          </label>
          <label className="vol-field">
            <span>Description (optional)</span>
            <input className="input" value={form.description} placeholder="Unraid SSH key for LXC testing"
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </label>
          <label className="vol-checkbox">
            <input type="checkbox" checked={form.readOnly}
              onChange={e => setForm(f => ({ ...f, readOnly: e.target.checked }))} />
            <span>Read-only</span>
          </label>
          {formSensitive && (
            <div className="vol-sensitive">⚠ This is a sensitive host path. Keep it read-only unless you are certain.</div>
          )}
          <div className="vol-form-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : (editIndex === null ? 'Add' : 'Save')}
            </button>
            <button className="btn btn-ghost" type="button" onClick={cancelForm} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ── Docker containers (LXC workspaces only) ──────── */
function DockerSection({ projectId, project, csrfToken, addToast }) {
  const [state, setState] = useState({ available: false, containers: [], reason: null });
  const [loading, setLoading] = useState(false);
  const [stopping, setStopping] = useState(null); // container id, or 'all'

  const running = project?.status === 'running';

  async function load() {
    if (!running) { setState({ available: false, containers: [], reason: 'workspace_stopped' }); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/docker`);
      const d = await r.json();
      if (d.error) { addToast(d.error, 'error'); return; }
      setState({ available: !!d.available, containers: d.containers || [], reason: d.reason || null });
    } catch (e) {
      addToast(e.message || 'Failed to list Docker containers.', 'error');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId, running]);

  async function stopOne(containerId, label) {
    setStopping(containerId);
    try {
      const r = await fetch(`/api/projects/${projectId}/docker/stop`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ containerId }),
      });
      const d = await r.json();
      if (!d.success) addToast(d.error || 'Stop failed.', 'error');
      else addToast(`Stopped ${label || containerId}.`);
    } catch (e) { addToast(e.message, 'error'); }
    finally { setStopping(null); load(); }
  }

  async function stopAll() {
    if (!confirm('Stop all running Docker containers in this workspace?')) return;
    setStopping('all');
    try {
      const r = await fetch(`/api/projects/${projectId}/docker/stop`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ all: true }),
      });
      const d = await r.json();
      if (!d.success) addToast(d.error || 'Stop failed.', 'error');
      else addToast(d.stopped ? `Stopped ${d.stopped} container${d.stopped === 1 ? '' : 's'}.` : 'No running containers.');
    } catch (e) { addToast(e.message, 'error'); }
    finally { setStopping(null); load(); }
  }

  const containers = state.containers || [];
  const reasonText = {
    workspace_stopped: 'Start the workspace to see and manage Docker containers.',
    not_installed: 'Docker is not installed in this workspace.',
    daemon_stopped: 'Docker is installed but its daemon is not running.',
  };

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <div className="panel-section-title">DOCKER CONTAINERS</div>
        <div className="ws-actions">
          <button className="btn btn-ghost" onClick={load} disabled={loading || !running}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {state.available && containers.length > 0 && (
            <button className="btn btn-ghost ws-danger" onClick={stopAll} disabled={stopping === 'all'}>
              {stopping === 'all' ? 'Stopping…' : 'Stop all'}
            </button>
          )}
        </div>
      </div>
      <p className="panel-hint">Containers running inside this LXC workspace's Docker.</p>

      {!state.available && (
        <p className="panel-hint">{reasonText[state.reason] || 'No Docker containers.'}</p>
      )}

      {state.available && containers.length === 0 && (
        <p className="panel-hint">No containers running.</p>
      )}

      {state.available && containers.map(c => {
        const up = /^up/i.test(c.status) || c.state === 'running';
        return (
          <div key={c.id} className="vol-row">
            <div className="vol-row-main">
              <div className="vol-paths">
                <span className={`dk-dot ${up ? 'up' : 'down'}`} />
                <code>{c.name || c.id.slice(0, 12)}</code>
                <span className="dk-image">{c.image}</span>
              </div>
              <div className="vol-desc">{c.status}{c.ports ? ` · ${c.ports}` : ''}</div>
            </div>
            <div className="vol-row-actions">
              <button className="btn btn-ghost ws-danger"
                onClick={() => stopOne(c.id, c.name)}
                disabled={stopping === c.id}>
                {stopping === c.id ? 'Stopping…' : 'Stop'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Workspace settings panel ──────────────────── */
function WorkspacePanel({ projectId, project, csrfToken, addToast, onDelete, onProjectUpdated }) {
  const [logs, setLogs] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [busy, setBusy] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [ip, setIp] = useState(null);
  const [ipLoading, setIpLoading] = useState(false);

  useEffect(() => {
    fetch('/api/projects/templates')
      .then(r => r.json())
      .then(data => setTemplates(data.templates || []))
      .catch(() => {});
  }, []);

  const isLxc = project?.backend === 'unraid_lxc';

  // Resolve the workspace's local IP. LXC re-resolves live (DHCP can change it
  // across restarts), so this is also exposed as a manual Refresh.
  const loadIp = useCallback(async () => {
    setIpLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/ip`);
      const d = await r.json();
      setIp(d.ip || null);
    } catch {
      setIp(null);
    } finally {
      setIpLoading(false);
    }
  }, [projectId]);

  // Fetch on mount and whenever the workspace becomes running (the IP is only
  // assigned while up, and a restart may hand out a new one).
  useEffect(() => {
    if (project?.status === 'running') loadIp();
    else setIp(null);
  }, [project?.status, loadIp]);

  async function runAction(action) {
    setBusy(action);
    try {
      const r = await fetch(`/api/projects/${projectId}/lifecycle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (!d.success) addToast(d.error || 'Action failed.', 'error');
      else {
        if (action === 'status') addToast(`Workspace status: ${d.status}.`);
        else if (action === 'repair-terminal') {
          if (d.repair && !d.repair.healthy) {
            addToast(`Repair ran, but the terminal agent isn't reachable yet${d.repair.ip ? ` (${d.repair.ip})` : ''}. Try again or Restart the workspace.`, 'error');
          } else {
            addToast(d.repair?.ip ? `Terminal agent repaired — reachable at ${d.repair.ip}.` : 'Terminal agent repaired.');
          }
        }
        else addToast(`${action.charAt(0).toUpperCase() + action.slice(1)} complete.`);
        if (d.status) onProjectUpdated?.({ status: d.status });
        // A start/restart/repair may hand out a new IP (LXC is DHCP); refresh it.
        if (action !== 'stop') loadIp();
      }
    } catch (e) { addToast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function loadLogs() {
    const r = await fetch(`/api/projects/${projectId}/logs`);
    const d = await r.json();
    setLogs(d.logs || 'No logs.');
  }

  async function changeTemplate(template) {
    if (!template || template === project?.template) return;
    setTemplateBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ template }),
      });
      const d = await r.json();
      if (!d.success) {
        addToast(d.error || 'Template update failed.', 'error');
        return;
      }
      onProjectUpdated?.(d.project);
      addToast(template === 'private'
        ? 'Template set to Private. Claude Azure settings were cleared; Rebuild to apply.'
        : 'Template set to Work. Rebuild to apply.');
    } catch (e) {
      addToast(e.message || 'Template update failed.', 'error');
    } finally {
      setTemplateBusy(false);
    }
  }

  const ACTIONS = isLxc ? [
    { id: 'start',           label: 'Start',           danger: false },
    { id: 'stop',            label: 'Stop',            danger: false },
    { id: 'restart',         label: 'Restart',         danger: false },
    { id: 'update',          label: 'Update',          danger: false },
    { id: 'repair-terminal', label: 'Repair terminal', danger: false },
    { id: 'status',          label: 'Status',          danger: false },
  ] : [
    { id: 'start',           label: 'Start',             danger: false },
    { id: 'stop',            label: 'Stop',              danger: false },
    { id: 'restart',         label: 'Restart',           danger: false },
    { id: 'update',          label: 'Update',            danger: false },
    { id: 'repair-terminal', label: 'Repair terminal',   danger: false },
    { id: 'recreate',        label: 'Recreate',          danger: true },
    { id: 'rebuild',         label: 'Rebuild',           danger: true },
    { id: 'reset',           label: 'Reset Environment', danger: true },
  ];

  // Some LXC actions (update) can take a while; reflect that in the button label.
  const busyLabel = (a) => {
    if (busy !== a.id) return a.label;
    if (a.id === 'update') return 'Updating…';
    if (a.id === 'status') return 'Checking…';
    if (a.id === 'repair-terminal') return 'Repairing…';
    return `${a.label}ing…`;
  };

  return (
    <div className="panel-content">
      <div className="panel-section">
        <div className="panel-section-title">WORKSPACE STATUS</div>
        <div className={`ws-status-row status-${project?.status}`}>
          <span className="ws-status-dot" />
          <span className="ws-status-text">{project?.status || 'unknown'}</span>
          <span className="panel-hint" style={{ marginLeft: 8 }}>
            {isLxc ? 'Unraid LXC' : 'Docker'}
          </span>
        </div>
        {isLxc ? (
          <>
            <div className="panel-hint">Container: <code>{project?.lxcContainerName || '—'}</code></div>
            <div className="panel-hint">Path: <code>{project?.lxcProjectPath || '—'}</code> → <code>/workspace</code></div>
          </>
        ) : (
          <div className="panel-hint">Folder: <code>/projects/{project?.folderPath}</code></div>
        )}
        <div className="panel-hint ws-ip-row">
          <span>Local IP: <code>{ipLoading ? '…' : (ip || '—')}</code></span>
          <button
            className="btn btn-ghost ws-ip-refresh"
            onClick={loadIp}
            disabled={ipLoading || project?.status !== 'running'}
            title={isLxc ? 'LXC IP is DHCP and can change on restart — refresh to re-resolve' : 'Refresh the workspace IP'}
          >
            {ipLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">WORKSPACE TEMPLATE</div>
        <select
          className="input ws-template-select"
          value={project?.template || 'claude-code'}
          onChange={e => changeTemplate(e.target.value)}
          disabled={templateBusy}
        >
          {(templates.length ? templates : [
            { id: 'claude-code', label: 'Work' },
            { id: 'private', label: 'Private' },
          ]).map(template => (
            <option key={template.id} value={template.id}>{template.label}</option>
          ))}
        </select>
        <div className="panel-hint">
          {isLxc
            ? 'Update applies the selected template inside the LXC (installs/updates tools). It does not recreate the container.'
            : 'Rebuild applies the selected template. Private removes Claude Azure AI Foundry settings.'}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">WORKSPACE CONTROLS</div>
        <div className="ws-actions">
          {ACTIONS.map(a => (
            <button key={a.id}
              className={`btn btn-ghost${a.danger ? ' ws-danger' : ''}`}
              onClick={() => runAction(a.id)}
              disabled={!!busy}
            >
              {busyLabel(a)}
            </button>
          ))}
        </div>
      </div>

      {isLxc && (
        <DockerSection
          projectId={projectId}
          project={project}
          csrfToken={csrfToken}
          addToast={addToast}
        />
      )}

      {!isLxc && (
        <VolumesSection
          projectId={projectId}
          project={project}
          csrfToken={csrfToken}
          addToast={addToast}
        />
      )}

      {!isLxc && (
        <div className="panel-section">
          <div className="panel-section-header">
            <div className="panel-section-title">CONTAINER LOGS</div>
            <button className="btn btn-ghost" onClick={() => { setShowLogs(s => !s); if (!showLogs) loadLogs(); }}>
              {showLogs ? 'Hide' : 'Show'}
            </button>
          </div>
          {showLogs && <div className="panel-logs"><pre>{logs}</pre></div>}
        </div>
      )}

      <div className="panel-section">
        <div className="panel-section-title">DANGER ZONE</div>
        <p className="panel-hint">
          Removes the workspace container and home volume.
          Project files on disk are <strong>not</strong> deleted.
        </p>
        <button className="btn btn-danger" onClick={onDelete}>
          Delete Project
        </button>
      </div>
    </div>
  );
}

const DEFAULT_TASK_SECTION_ID = 'open';

function makeTaskSectionId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `section-${Date.now()}-${Math.random()}`;
}

function collectPlanningMarkdownFiles(nodes, files = []) {
  for (const node of nodes || []) {
    if (node.type === 'dir') collectPlanningMarkdownFiles(node.children || [], files);
    else if (/\.(md|mdx)$/i.test(node.name)) files.push(node);
  }
  return files;
}

function normalizeTaskSections(savedSections) {
  const sections = Array.isArray(savedSections) ? savedSections : [];
  const cleanSections = sections
    .filter(section => section?.id && section?.title)
    .map(section => ({ id: section.id, title: section.title }));
  if (!cleanSections.some(section => section.id === DEFAULT_TASK_SECTION_ID)) {
    cleanSections.unshift({ id: DEFAULT_TASK_SECTION_ID, title: 'Open' });
  }
  return cleanSections;
}

function normalizeTasks(savedTasks, sections) {
  const sectionIds = new Set(sections.map(section => section.id));
  return (Array.isArray(savedTasks) ? savedTasks : []).map(task => {
    const sectionId = sectionIds.has(task.sectionId) ? task.sectionId : DEFAULT_TASK_SECTION_ID;
    return {
      ...task,
      sectionId,
      description: task.description || '',
      planningPath: task.planningPath || '',
    };
  });
}

function TaskEditModal({ task, planningFiles, onClose, onSave }) {
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [planningPath, setPlanningPath] = useState(task?.planningPath || '');

  useEffect(() => {
    setTitle(task?.title || '');
    setDescription(task?.description || '');
    setPlanningPath(task?.planningPath || '');
  }, [task?.id]);

  if (!task) return null;

  function submit(e) {
    e.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    onSave(task.id, {
      title: nextTitle,
      description: description.trim(),
      planningPath,
    });
  }

  return (
    <div className="modal-backdrop task-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="modal task-edit-modal" role="dialog" aria-modal="true" aria-labelledby="task-edit-title" onSubmit={submit}>
        <div className="modal-header">
          <h2 id="task-edit-title" className="modal-title">Edit task</h2>
        </div>
        <div className="modal-body task-edit-body">
          <label className="task-field-label">
            <span>Title</span>
            <input
              className="task-modal-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
            />
          </label>
          <label className="task-field-label">
            <span>Description</span>
            <textarea
              className="task-modal-textarea"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={5}
            />
          </label>
          <label className="task-field-label">
            <span>Planning file</span>
            <select className="task-modal-input" value={planningPath} onChange={e => setPlanningPath(e.target.value)}>
              <option value="">No linked file</option>
              {planningFiles.map(file => (
                <option key={file.path} value={file.path}>{file.path.replace(/^\.planning\/?/, '')}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={!title.trim()}>Save</button>
        </div>
      </form>
    </div>
  );
}

function TaskRow({ task, onToggleTask, onDeleteTask, onEditTask, onDragStart, onOpenLinkedPlanningFile }) {
  return (
    <div
      className={`task-row${task.completed ? ' completed' : ''}`}
      draggable={!task.completed}
      onDragStart={e => onDragStart(e, task.id)}
    >
      <input
        type="checkbox"
        checked={task.completed}
        onChange={() => onToggleTask(task.id)}
        aria-label={task.completed ? `Mark ${task.title} open` : `Mark ${task.title} done`}
      />
      <button type="button" className="task-main-btn" onClick={() => onEditTask(task.id)}>
        <span className="task-title">{task.title}</span>
        {(task.description || task.planningPath) && (
          <span className="task-meta">
            {task.description && <span>Description</span>}
            {task.planningPath && <span>{task.planningPath.replace(/^\.planning\/?/, '')}</span>}
          </span>
        )}
      </button>
      {task.planningPath && (
        <button
          type="button"
          className="task-link-btn"
          title="Open linked planning file"
          aria-label="Open linked planning file"
          onClick={() => onOpenLinkedPlanningFile(task.planningPath)}
        >
          ↗
        </button>
      )}
      <button type="button" className="task-delete-btn" aria-label={`Delete ${task.title}`} onClick={() => onDeleteTask(task.id)}>×</button>
    </div>
  );
}

function TasksPanel({
  tasks,
  taskSections,
  taskDraft,
  taskSectionDraft,
  completedOpen,
  planningTree,
  onDraftChange,
  onSectionDraftChange,
  onAddTask,
  onAddSection,
  onDeleteSection,
  onRenameSection,
  onToggleTask,
  onDeleteTask,
  onEditTask,
  editingTaskId,
  onCloseTaskEditor,
  onSaveTask,
  onMoveTask,
  onToggleCompleted,
  onOpenLinkedPlanningFile,
}) {
  const planningFiles = collectPlanningMarkdownFiles(planningTree);
  const completedTasks = tasks.filter(t => t.completed);

  const [editingSectionId, setEditingSectionId] = useState(null);
  const [sectionTitleDraft, setSectionTitleDraft] = useState('');

  function startRename(section) {
    setSectionTitleDraft(section.title);
    setEditingSectionId(section.id);
  }
  function commitRename(sectionId) {
    if (sectionTitleDraft.trim()) onRenameSection(sectionId, sectionTitleDraft);
    setEditingSectionId(null);
  }

  function submitTask(e) {
    e.preventDefault();
    onAddTask();
  }

  function submitSection(e) {
    e.preventDefault();
    onAddSection();
  }

  function handleDragStart(e, taskId) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  }

  function handleDrop(e, sectionId) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) onMoveTask(taskId, sectionId);
  }

  return (
    <div className="panel-content tasks-content">
      <form className="task-add-row" onSubmit={submitTask}>
        <input
          className="task-input"
          value={taskDraft}
          onChange={e => onDraftChange(e.target.value)}
          placeholder="Add a task…"
          aria-label="Add a task"
        />
        <button className="btn btn-primary" type="submit" disabled={!taskDraft.trim()}>Add</button>
      </form>

      <div className="task-sections">
        {taskSections.map(section => {
          const sectionTasks = tasks.filter(t => !t.completed && (t.sectionId || DEFAULT_TASK_SECTION_ID) === section.id);
          const isDefault = section.id === DEFAULT_TASK_SECTION_ID;
          return (
            <section
              key={section.id}
              className="task-section"
              onDragOver={e => e.preventDefault()}
              onDrop={e => handleDrop(e, section.id)}
            >
              <div className="task-section-header">
                {editingSectionId === section.id ? (
                  <input
                    className="task-section-title-input"
                    value={sectionTitleDraft}
                    autoFocus
                    aria-label="Section name"
                    onChange={e => setSectionTitleDraft(e.target.value)}
                    onBlur={() => commitRename(section.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(section.id); }
                      if (e.key === 'Escape') setEditingSectionId(null);
                    }}
                  />
                ) : (
                  <span
                    className="task-section-title"
                    title="Double-click to rename"
                    onDoubleClick={() => startRename(section)}
                  >
                    {section.title}
                  </span>
                )}
                <span className="task-count">{sectionTasks.length}</span>
                <button
                  type="button"
                  className="task-section-edit"
                  title="Rename section"
                  aria-label={`Rename section ${section.title}`}
                  onClick={() => startRename(section)}
                >
                  ✎
                </button>
                {!isDefault && (
                  <button
                    type="button"
                    className="task-section-delete"
                    title="Delete section (tasks move to Open)"
                    aria-label={`Delete section ${section.title}`}
                    onClick={() => onDeleteSection(section.id)}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="task-list">
                {sectionTasks.length === 0 && (
                  <p className="task-empty">{isDefault ? 'No tasks yet' : 'Drag tasks here'}</p>
                )}
                {sectionTasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggleTask={onToggleTask}
                    onDeleteTask={onDeleteTask}
                    onEditTask={onEditTask}
                    onDragStart={handleDragStart}
                    onOpenLinkedPlanningFile={onOpenLinkedPlanningFile}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <form className="task-add-section" onSubmit={submitSection}>
        <input
          className="task-input task-input-sm"
          value={taskSectionDraft}
          onChange={e => onSectionDraftChange(e.target.value)}
          placeholder="New section…"
          aria-label="Add a section"
        />
        <button className="btn btn-ghost" type="submit" disabled={!taskSectionDraft.trim()}>+ Section</button>
      </form>

      <div className="task-completed-section">
        <button className="task-completed-toggle" type="button" onClick={onToggleCompleted}>
          <span className="task-completed-caret">{completedOpen ? '▾' : '▸'}</span>
          <span>Completed</span>
          <span className="task-count">{completedTasks.length}</span>
        </button>
        {completedOpen && (
          <div className="task-list completed">
            {completedTasks.length === 0 && <p className="panel-hint">No completed tasks.</p>}
            {completedTasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                onToggleTask={onToggleTask}
                onDeleteTask={onDeleteTask}
                onEditTask={onEditTask}
                onDragStart={handleDragStart}
                onOpenLinkedPlanningFile={onOpenLinkedPlanningFile}
              />
            ))}
          </div>
        )}
      </div>

      <TaskEditModal
        task={tasks.find(task => task.id === editingTaskId)}
        planningFiles={planningFiles}
        onClose={onCloseTaskEditor}
        onSave={onSaveTask}
      />
    </div>
  );
}

/* ── Git panel ─────────────────────────────────── */
function gitRepoLabel(path) {
  if (!path) return '';
  if (path === '/workspace') return 'workspace';
  return path.split('/').filter(Boolean).pop();
}

function GitPanel({ projectId, csrfToken, addToast }) {
  const [status, setStatus] = useState(null);
  const [staged, setStaged] = useState(new Set());
  const [msg, setMsg] = useState('');
  const [diff, setDiff] = useState('');
  const [snapshots, setSnaps] = useState([]);
  const [repos, setRepos] = useState([]);
  const [activeRepo, setActiveRepo] = useState(null);

  useEffect(() => { loadStatus(); loadRepos(); loadSnaps(); const t = setInterval(loadStatus, 3000); return () => clearInterval(t); }, [projectId]);

  async function loadStatus() {
    try { const r = await fetch(`/api/projects/${projectId}/git/status`); setStatus(await r.json()); } catch (_) {}
  }
  async function loadRepos() {
    try { const r = await fetch(`/api/projects/${projectId}/git/repos`); const d = await r.json(); setRepos(d.repos || []); setActiveRepo(d.active || null); } catch (_) {}
  }
  async function selectRepo(path) {
    if (!path || path === activeRepo) return;
    const r = await fetch(`/api/projects/${projectId}/git/repos/active`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ path }) });
    const d = await r.json();
    if (d.success) { setActiveRepo(d.active); setStaged(new Set()); setDiff(''); addToast(`Switched to ${gitRepoLabel(d.active)}.`); loadStatus(); loadSnaps(); }
    else addToast(d.error || 'Could not switch repository.', 'error');
  }
  async function loadSnaps() {
    try { const r = await fetch(`/api/projects/${projectId}/git/snapshots`); const d = await r.json(); setSnaps(d.snapshots || []); } catch (_) {}
  }
  async function loadDiff(path) {
    const r = await fetch(`/api/projects/${projectId}/git/diff?path=${encodeURIComponent(path)}`);
    const d = await r.json(); setDiff(d.diff || '');
  }
  async function stage(path, doStage) {
    await fetch(`/api/projects/${projectId}/git/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ files: [path], unstage: !doStage }) });
    setStaged(prev => { const n = new Set(prev); doStage ? n.add(path) : n.delete(path); return n; });
  }
  async function commit() {
    if (!msg.trim()) { addToast('Commit message required.', 'error'); return; }
    const r = await fetch(`/api/projects/${projectId}/git/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ message: msg }) });
    const d = await r.json();
    if (d.success) { addToast('Committed.'); setMsg(''); setStaged(new Set()); loadStatus(); }
    else addToast(d.error || 'Commit failed.', 'error');
  }
  async function snapshot() {
    const label = prompt('Snapshot label (optional):');
    if (label === null) return;
    const r = await fetch(`/api/projects/${projectId}/git/snapshot`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ label }) });
    const d = await r.json();
    if (d.success) { addToast(`Snapshot: ${d.tag}`); loadSnaps(); }
    else addToast(d.error, 'error');
  }
  async function restore(tag) {
    if (!confirm(`Restore workspace to ${tag}? This resets the current branch to the snapshot and removes file changes made after it.`)) return;
    const r = await fetch(`/api/projects/${projectId}/git/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ tag }) });
    const d = await r.json();
    if (d.success) { addToast(`Workspace restored to ${tag}`); loadStatus(); } else addToast(d.error, 'error');
  }

  if (!status) return <div className="panel-content"><p className="panel-loading">Loading…</p></div>;
  if (!status.initialized) return <div className="panel-content"><p className="panel-hint">Git not initialized. Run <code>git init</code> in the terminal.</p></div>;

  const unstaged = (status.files || []).filter(f => !staged.has(f.path));
  const stagedFiles = (status.files || []).filter(f => staged.has(f.path));

  return (
    <div className="panel-content">
      <div className="panel-section">
        <div className="panel-section-header">
          <div className="panel-section-title">
            {repos.length > 1 && (
              <select
                className="git-repo-select"
                value={activeRepo || ''}
                onChange={e => selectRepo(e.target.value)}
                title={activeRepo || 'Active repository'}
              >
                {repos.map(r => (
                  <option key={r.path} value={r.path}>{gitRepoLabel(r.path)}{r.clean ? '' : ' •'}</option>
                ))}
              </select>
            )}
            ⎇ {status.branch}
          </div>
          <div style={{ display:'flex', gap: 4 }}>
            <button className="btn btn-ghost" style={{fontSize:'var(--font-size-xs)'}} onClick={snapshot}>Snapshot</button>
          </div>
        </div>
        {status.clean ? <p className="panel-hint">Working tree clean.</p> : (
          <>
            {unstaged.length > 0 && (
              <div className="git-file-list">
                <div className="git-list-label">Unstaged</div>
                {unstaged.map(f => (
                  <div key={f.path} className="git-file-row" onClick={() => loadDiff(f.path)}>
                    <input type="checkbox" checked={false} onChange={() => stage(f.path, true)} onClick={e => e.stopPropagation()} />
                    <span className={`git-badge badge-${f.status}`}>{f.status}</span>
                    <span className="git-file-name">{f.path}</span>
                  </div>
                ))}
              </div>
            )}
            {stagedFiles.length > 0 && (
              <div className="git-file-list">
                <div className="git-list-label">Staged</div>
                {stagedFiles.map(f => (
                  <div key={f.path} className="git-file-row staged" onClick={() => loadDiff(f.path)}>
                    <input type="checkbox" checked onChange={() => stage(f.path, false)} onClick={e => e.stopPropagation()} />
                    <span className={`git-badge badge-${f.status}`}>{f.status}</span>
                    <span className="git-file-name">{f.path}</span>
                  </div>
                ))}
                <div className="git-commit-area">
                  <textarea className="git-commit-input" placeholder="Commit message…" value={msg} onChange={e => setMsg(e.target.value)} />
                  <button className="btn btn-primary" onClick={commit}>Commit</button>
                </div>
              </div>
            )}
            {diff && (
              <div className="git-diff">
                {diff.split('\n').map((line, i) => (
                  <div key={i} className={`diff-line${line.startsWith('+') && !line.startsWith('+++') ? ' added' : line.startsWith('-') && !line.startsWith('---') ? ' removed' : line.startsWith('@@') ? ' hunk' : ''}`}>
                    <code>{line || ' '}</code>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div className="panel-section">
        <div className="panel-section-title">SNAPSHOTS</div>
        {snapshots.length === 0 ? <p className="panel-hint">No snapshots. Create one before an AI session.</p> : snapshots.map(s => (
          <div key={s.tag} className="snapshot-row">
            <div>
              <div className="snapshot-tag">{s.tag}</div>
              {s.label && <div className="snapshot-label">{s.label}</div>}
            </div>
            <button className="btn btn-ghost" style={{fontSize:'var(--font-size-xs)'}} onClick={() => restore(s.tag)}>Restore</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Cockpit ───────────────────────────────────── */
export default function ProjectCockpit() {
  const { id: projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { csrfToken } = useAuth();
  const { addToast } = useToast();

  const [project, setProject]     = useState(null);
  const [tree, setTree]           = useState([]);
  const [planningTree, setPlanningTree] = useState([]);
  const [termTabs, setTermTabs]   = useState([]);
  const [terminalCommands, setTerminalCommands] = useState(DEFAULT_TERMINAL_COMMANDS);
  const [fileTabs, setFileTabs]   = useState([]);
  const [fileContent, setFileContent] = useState({});
  const [dirtyFiles, setDirty]    = useState({});
  const [activeTab, setActiveTab] = useState(null); // 'term-{id}' | 'file-{path}' | 'settings' | 'git'
  const [lastActiveTermId, setLastActiveTermId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [taskSections, setTaskSections] = useState([{ id: DEFAULT_TASK_SECTION_ID, title: 'Open' }]);
  const [taskDraft, setTaskDraft] = useState('');
  const [taskSectionDraft, setTaskSectionDraft] = useState('');
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [completedTasksOpen, setCompletedTasksOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  // Gate server writes until the board has loaded for the current project, so we
  // never persist an empty board over real data during the load round-trip.
  const tasksLoadedRef = useRef(false);
  const [reconnecting, setRecon]  = useState(false);
  const [reconSecs, setReconSecs] = useState(0);
  const [deleting, setDeleting]   = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [hoveredTreeProject, setHoveredTreeProject] = useState(false);
  const [commandMenu, setCommandMenu] = useState(null); // { x, y }
  const [fileContextMenu, setFileContextMenu] = useState(null); // { node, x, y }
  const [renameDialog, setRenameDialog] = useState(null); // { node, value }
  const [markedNode, setMarkedNode] = useState(null); // anchor for range/keyboard ops
  const [selectedPaths, setSelectedPaths] = useState(() => new Set()); // multi-selection
  const [expandedPaths, setExpandedPaths] = useState(() => new Set());
  const [treeWidth, setTreeWidth] = useState(() => {
    const saved = Number(localStorage.getItem('opus:filetree-width'));
    return Number.isFinite(saved) && saved >= 160 && saved <= 520 ? saved : 220;
  });
  const [filePanelWidth, setFilePanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('opus:file-panel-width'));
    return Number.isFinite(saved) && saved >= 320 && saved <= 900 ? saved : 560;
  });
  const [resizingTree, setResizingTree] = useState(false);
  const [resizingFilePanel, setResizingFilePanel] = useState(false);
  const renameInputRef = useRef(null);
  const cockpitMainRef = useRef(null);
  const fileTreeRef = useRef(null);
  const fileTreePanelRef = useRef(null);
  const uploadInputRef = useRef(null);
  const uploadTargetRef = useRef('');
  const uploadLabelRef = useRef('Project Files');
  const autosaveTimers = useRef({});
  const fileContentRef = useRef({});
  const treeSignatureRef = useRef('');

  const termRefs         = useRef({});
  const activeRef        = useRef(null);
  // Timestamp of the last terminal keystroke — used to pause background
  // polling (file tree) while the user is actively typing, avoiding jank.
  const lastInputRef     = useRef(0);
  // Track which sessions this socket client has already joined (and received scrollback for).
  // Cleared on socket reconnect because the server treats it as a brand-new client.
  const joinedSessions   = useRef(new Set());
  // Guard: scrollback can only be written once per xterm instance.
  // Cleared alongside joinedSessions so a reconnect gets a fresh replay.
  const historyReplayed  = useRef(new Set());
  // Scrollback that arrived before TerminalInstance finished opening (fonts still loading).
  // TerminalInstance reads and clears this once term.open() completes.
  const pendingScrollback = useRef({});
  // Tracks the current projectId so async callbacks can detect stale results.
  const currentProjectId = useRef(projectId);

  // Mobile tab context
  const { mobileTab, setMobileTab } = useMobileUI();
  const { isMobile } = useDevice();
  const prevMobileTab = useRef(null);
  const activeTabStateRef = useRef(null);

  useEffect(() => {
    activeTabStateRef.current = activeTab;
  }, [activeTab]);

  // Replay a soft entrance on the work surface whenever the project changes.
  // The route component is reused across :id changes (terminals stay mounted),
  // so we restart the CSS animation manually rather than relying on mount.
  useEffect(() => {
    const el = cockpitMainRef.current;
    if (!el) return;
    el.classList.remove('project-switch-in');
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add('project-switch-in');
  }, [projectId]);

  useEffect(() => {
    fileContentRef.current = fileContent;
  }, [fileContent]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`opus:filetree-expanded:${projectId}`) || '[]');
      setExpandedPaths(new Set(Array.isArray(saved) ? saved : []));
    } catch {
      setExpandedPaths(new Set());
    }
  }, [projectId]);

  useEffect(() => {
    localStorage.setItem('opus:filetree-width', String(treeWidth));
  }, [treeWidth]);

  useEffect(() => {
    localStorage.setItem('opus:file-panel-width', String(filePanelWidth));
  }, [filePanelWidth]);

  // Load the task board for this project from the server (shared across devices).
  // Falls back to any pre-sync tasks left in this browser's localStorage and
  // adopts them — the debounced save effect below then pushes them to the server.
  useEffect(() => {
    let cancelled = false;
    tasksLoadedRef.current = false;
    setTaskDraft('');
    setTaskSectionDraft('');
    setEditingTaskId(null);
    setCompletedTasksOpen(false);

    (async () => {
      let savedTasks = [];
      let savedSections = [];
      try {
        const r = await fetch(`/api/projects/${projectId}/tasks`);
        if (r.ok) {
          const d = await r.json();
          savedTasks = Array.isArray(d.tasks) ? d.tasks : [];
          savedSections = Array.isArray(d.sections) ? d.sections : [];
        }
      } catch (_) {}

      // One-time migration: server has nothing yet, but this browser does.
      if (!savedTasks.length && !savedSections.length) {
        try { savedTasks = JSON.parse(localStorage.getItem(`opus:tasks:${projectId}`) || '[]'); } catch (_) {}
        try { savedSections = JSON.parse(localStorage.getItem(`opus:task-sections:${projectId}`) || '[]'); } catch (_) {}
      }

      if (cancelled) return;
      const nextSections = normalizeTaskSections(savedSections);
      const nextTasks = normalizeTasks(savedTasks, nextSections);
      setTaskSections(nextSections);
      setTasks(nextTasks);
      tasksLoadedRef.current = true;
    })();

    return () => { cancelled = true; };
  }, [projectId]);

  // Persist the board to the server (debounced) whenever it changes. Skipped
  // until the initial load completes so we don't clobber stored data.
  useEffect(() => {
    if (!tasksLoadedRef.current) return;
    const pid = projectId;
    const timer = setTimeout(() => {
      fetch(`/api/projects/${pid}/tasks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ tasks, sections: taskSections }),
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [tasks, taskSections, projectId, csrfToken]);

  useEffect(() => {
    if (!renameDialog) return;
    requestAnimationFrame(() => renameInputRef.current?.select());
  }, [renameDialog?.node.path]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/terminal-commands')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const commands = Array.isArray(data.commands) ? data.commands : [];
        setTerminalCommands(commands.filter(cmd => cmd.displayName && Array.isArray(cmd.commands) && cmd.commands.length));
      })
      .catch(() => {
        if (!cancelled) setTerminalCommands(DEFAULT_TERMINAL_COMMANDS);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!fileContextMenu) return;
    function closeMenu() { setFileContextMenu(null); }
    function closeOnEscape(e) {
      if (e.key === 'Escape') closeMenu();
    }
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [!!fileContextMenu]);

  useEffect(() => {
    if (!commandMenu) return;
    function closeMenu() { setCommandMenu(null); }
    function closeOnEscape(e) {
      if (e.key === 'Escape') closeMenu();
    }
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [!!commandMenu]);

  // Handle ?tab= from context menu (desktop right-click)
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'settings') { setActiveTab('settings'); activeRef.current = 'settings'; setSearchParams({}); }
    else if (tab === 'git') { setActiveTab('git'); activeRef.current = 'git'; setSearchParams({}); }
    else if (tab === 'tasks') { setTasksOpen(true); setSearchParams({}); }
  }, [searchParams]);

  // Sync mobile tab → cockpit activeTab (only on mobile devices)
  useEffect(() => {
    if (prevMobileTab.current === mobileTab) return;
    prevMobileTab.current = mobileTab;
    if (!isMobile) return;
    if (mobileTab === 'terminal') {
      const first = termTabs[0];
      if (first) activateTerm(first.id);
    } else if (mobileTab === 'git') {
      setActiveTab('git');
      activeRef.current = 'git';
    } else if (mobileTab === 'settings') {
      setActiveTab('settings');
      activeRef.current = 'settings';
    }
    // 'files' view is CSS-driven via data-mobile-tab attribute
  }, [mobileTab, termTabs]);

  useEffect(() => {
    currentProjectId.current = projectId;
    Object.values(autosaveTimers.current).forEach(clearTimeout);
    autosaveTimers.current = {};
    treeSignatureRef.current = '';
    activeRef.current = null;
    termRefs.current = {};
    pendingScrollback.current = {};
    joinedSessions.current.clear();
    historyReplayed.current.clear();
    setActiveTab(null);
    setLastActiveTermId(null);
    setTermTabs([]);
    setFileTabs([]);
    setFileContent({});
    setDirty({});
    setPlanningTree([]);
    setTaskDraft('');
    setTaskSectionDraft('');
    setEditingTaskId(null);
    setTasksOpen(false);
    setMarkedNode(null);
    setSelectedPaths(new Set());
    loadProject(); loadTree(); loadSessions();
    const t1 = setInterval(() => {
      if (!activeTabStateRef.current?.startsWith('term-')) loadProject();
    }, 5000);
    // Poll the file tree, but (a) skip a cycle while the user is actively typing
    // and (b) run the refresh — including the fetch, JSON diff and any re-render —
    // in browser idle time, so it never lands on a keystroke and stalls input.
    const t2 = setInterval(() => {
      if (Date.now() - lastInputRef.current < 1500) return;
      loadTree();
    }, 2000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      Object.values(autosaveTimers.current).forEach(clearTimeout);
      autosaveTimers.current = {};
    };
  }, [projectId]);

  useEffect(() => {
    const sock = getSocket();

    function onConnect() {
      setRecon(false);
      // New socket connection → server has no record of us. Clear client-side join
      // tracking so activateTerm will re-emit terminal:join (with scrollback).
      joinedSessions.current.clear();
      historyReplayed.current.clear();
      console.log('[socket] Connected/reconnected — cleared join & history state');

      // Re-join active session with scrollback (server sees this as a new client)
      if (activeRef.current?.startsWith('term-')) {
        const sid = activeRef.current.slice(5);
        console.log(`[socket] Re-joining session ${sid.slice(0,8)} after reconnect`);
        sock.emit('terminal:join', { sessionId: sid });
        joinedSessions.current.add(sid);
        // historyReplayed stays clear so onScrollback will accept the replay
      }
    }

    function onDisconnect() {
      setRecon(true);
      setReconSecs(0);
      console.log('[socket] Disconnected');
    }

    function onData({ sessionId, data }) {
      termRefs.current[sessionId]?.write(data);
    }

    function onScrollback({ sessionId, data }) {
      if (historyReplayed.current.has(sessionId)) {
        console.log(`[terminal] SKIPPED duplicate scrollback for session ${sessionId.slice(0,8)}`);
        return;
      }
      const bytes = typeof data === 'string' ? data.length : 0;
      console.log(`[terminal] Replaying ${bytes} bytes history for session ${sessionId.slice(0,8)}`);
      const ref = termRefs.current[sessionId];
      if (ref) {
        // Terminal already open — apply immediately.
        // reset() wipes the scrollback buffer before replaying; clear() only
        // scrolls content up into the buffer, causing duplicate output on scroll.
        historyReplayed.current.add(sessionId);
        ref.reset();
        ref.write(data);
      } else {
        // Terminal not open yet (fonts still loading or first render not committed).
        // Store for TerminalInstance to pick up once term.open() completes.
        // Do not mark this replayed yet: fast project switching can unmount the
        // terminal before the pending data is written.
        pendingScrollback.current[sessionId] = data;
      }
    }

    function onExit({ sessionId }) {
      joinedSessions.current.delete(sessionId);
      historyReplayed.current.delete(sessionId);
      setTermTabs(p => p.filter(t => t.id !== sessionId));
    }

    function onAi({ sessionId, state }) {
      setTermTabs(p => p.map(t => t.id === sessionId ? { ...t, aiState: state } : t));
    }

    console.log(`[socket] Attaching listeners for project ${projectId}`);
    sock.on('connect',           onConnect);
    sock.on('disconnect',        onDisconnect);
    sock.on('terminal:data',     onData);
    sock.on('terminal:scrollback', onScrollback);
    sock.on('terminal:exit',     onExit);
    sock.on('terminal:ai-state', onAi);

    return () => {
      console.log(`[socket] Removing listeners for project ${projectId}`);
      sock.off('connect',           onConnect);
      sock.off('disconnect',        onDisconnect);
      sock.off('terminal:data',     onData);
      sock.off('terminal:scrollback', onScrollback);
      sock.off('terminal:exit',     onExit);
      sock.off('terminal:ai-state', onAi);
    };
  }, [projectId]);

  useEffect(() => { if (!reconnecting) return; const t = setInterval(() => setReconSecs(n=>n+1), 1000); return () => clearInterval(t); }, [reconnecting]);

  async function loadProject() { try { const r = await fetch(`/api/projects/${projectId}`); if (r.ok) setProject(await r.json()); } catch (_) {} }
  async function loadTree() {
    try {
      const r = await fetch(`/api/projects/${projectId}/files`);
      const d = await r.json();
      const nextTree = d.projectTree || d.tree || [];
      const nextPlanningTree = d.planningTree || [];
      // Do the expensive part — stringify diff + (possible) re-render — in idle
      // time. requestIdleCallback waits for the main thread to be free, so this
      // can't stall terminal input even right as the poll completes.
      runWhenIdle(() => {
        const nextSignature = JSON.stringify({ project: nextTree, planning: nextPlanningTree });
        if (nextSignature === treeSignatureRef.current) return;
        treeSignatureRef.current = nextSignature;
        setTree(nextTree);
        setPlanningTree(nextPlanningTree);
      });
    } catch (_) {}
  }

  // State updates only — the debounced effect above syncs the board to the server.
  function updateTasks(updater) {
    setTasks(prev => updater(prev));
  }

  function updateTaskSections(updater) {
    setTaskSections(prev => normalizeTaskSections(updater(prev)));
  }

  function addTask() {
    const title = taskDraft.trim();
    if (!title) return;
    updateTasks(prev => [
      ...prev,
      {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        title,
        sectionId: DEFAULT_TASK_SECTION_ID,
        description: '',
        planningPath: '',
        completed: false,
        createdAt: Date.now(),
        completedAt: null,
      },
    ]);
    setTaskDraft('');
  }

  function addTaskSection() {
    const title = taskSectionDraft.trim();
    if (!title) return;
    updateTaskSections(prev => [...prev, { id: makeTaskSectionId(), title }]);
    setTaskSectionDraft('');
  }

  function deleteTaskSection(sectionId) {
    if (sectionId === DEFAULT_TASK_SECTION_ID) return;
    // Don't lose tasks — move them back to the default "Open" section.
    updateTasks(prev => prev.map(task => (
      task.sectionId === sectionId ? { ...task, sectionId: DEFAULT_TASK_SECTION_ID } : task
    )));
    updateTaskSections(prev => prev.filter(section => section.id !== sectionId));
  }

  function renameTaskSection(sectionId, title) {
    const clean = title.trim();
    if (!clean) return;
    updateTaskSections(prev => prev.map(section => (
      section.id === sectionId ? { ...section, title: clean } : section
    )));
  }

  function toggleTask(id) {
    updateTasks(prev => prev.map(task => (
      task.id === id
        ? { ...task, completed: !task.completed, completedAt: task.completed ? null : Date.now() }
        : task
    )));
  }

  function deleteTask(id) {
    updateTasks(prev => prev.filter(task => task.id !== id));
    if (editingTaskId === id) setEditingTaskId(null);
  }

  function moveTask(taskId, sectionId) {
    updateTasks(prev => prev.map(task => (
      task.id === taskId ? { ...task, sectionId, completed: false, completedAt: null } : task
    )));
  }

  function saveTask(id, updates) {
    updateTasks(prev => prev.map(task => (
      task.id === id ? { ...task, ...updates } : task
    )));
    setEditingTaskId(null);
  }

  function openLinkedPlanningFile(path) {
    const name = path.split('/').pop() || path;
    openFile({ path, name, type: 'file' });
  }

  function toggleTasksPanel() {
    if (activeTab === 'git' || activeTab === 'settings') {
      const term = termTabs.find(t => t.id === activeTermId) || termTabs[0];
      if (term) activateTerm(term.id);
      else setActiveTab(null);
    }
    setTasksOpen(open => !open);
  }

  function persistExpandedPaths(next) {
    localStorage.setItem(`opus:filetree-expanded:${projectId}`, JSON.stringify([...next]));
  }

  function toggleFolder(path) {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      persistExpandedPaths(next);
      return next;
    });
  }

  function startResizeFileTree(e) {
    e.preventDefault();
    setResizingTree(true);
    const startX = e.clientX;
    const startWidth = fileTreePanelRef.current?.getBoundingClientRect().width || treeWidth;

    function onMove(moveEvent) {
      const next = Math.max(160, Math.min(520, Math.round(startWidth + moveEvent.clientX - startX)));
      setTreeWidth(next);
    }

    function onUp() {
      setResizingTree(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startResizeFilePanel(e) {
    e.preventDefault();
    setResizingFilePanel(true);
    const startX = e.clientX;
    const startWidth = filePanelWidth;
    const contentWidth = e.currentTarget.parentElement?.getBoundingClientRect().width || window.innerWidth;

    function onMove(moveEvent) {
      const maxWidth = Math.max(320, contentWidth - 280);
      const next = Math.max(320, Math.min(maxWidth, Math.round(startWidth - (moveEvent.clientX - startX))));
      setFilePanelWidth(next);
    }

    function onUp() {
      setResizingFilePanel(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function workspacePath(node) {
    const suffix = node?.path ? `/${node.path}` : '';
    return `/workspace${suffix}`;
  }

  function isPlanningRootNode(node) {
    return node?.path === '.planning';
  }

  function quoteForTerminal(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  // Flatten the two visible trees (planning + project) into the order they appear
  // on screen, honoring which folders are expanded. Drives Shift-range selection
  // and resolves selected paths back to node objects for copy/cut/delete.
  const { visibleOrder, nodeByPath } = useMemo(() => {
    const order = [];
    const map = new Map();
    const walk = nodes => {
      for (const n of nodes) {
        order.push(n.path);
        map.set(n.path, n);
        if (n.type === 'dir' && expandedPaths.has(n.path) && n.children) walk(n.children);
      }
    };
    walk(planningTree);
    walk(tree);
    return { visibleOrder: order, nodeByPath: map };
  }, [planningTree, tree, expandedPaths]);

  function clearSelection() {
    setSelectedPaths(new Set());
    setMarkedNode(null);
  }

  // Resolve the current multi-selection to node objects (dropping any that have
  // disappeared from the tree since they were selected).
  function selectedNodes() {
    return Array.from(selectedPaths).map(p => nodeByPath.get(p)).filter(Boolean);
  }

  // The nodes an action should affect: the whole multi-selection when the acted-on
  // node is part of it, otherwise just that single node.
  function operationNodes(node) {
    if (node && selectedPaths.has(node.path) && selectedPaths.size > 1) return selectedNodes();
    if (node) return [node];
    return selectedNodes();
  }

  // Click-selection with Ctrl (toggle one) / Shift (extend range) / plain (replace).
  function selectNode(node, { ctrl, shift } = {}) {
    if (shift && markedNode) {
      const a = visibleOrder.indexOf(markedNode.path);
      const b = visibleOrder.indexOf(node.path);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedPaths(new Set(visibleOrder.slice(lo, hi + 1)));
        return; // keep the existing anchor for further range extension
      }
    }
    if (ctrl) {
      setSelectedPaths(prev => {
        const next = new Set(prev);
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
        return next;
      });
      setMarkedNode(node);
      return;
    }
    setSelectedPaths(new Set([node.path]));
    setMarkedNode(node);
  }

  // Right-click keeps an existing multi-selection (so the menu acts on all of it),
  // but selects the node when it sits outside the current selection.
  function contextSelectNode(node) {
    if (selectedPaths.has(node.path)) { setMarkedNode(node); return; }
    setSelectedPaths(new Set([node.path]));
    setMarkedNode(node);
  }

  function getClipboardPayload() {
    try {
      return JSON.parse(localStorage.getItem('opus:file-clipboard') || 'null');
    } catch {
      return null;
    }
  }

  function setClipboardPayload(mode, nodes) {
    const sources = (Array.isArray(nodes) ? nodes : [nodes])
      .filter(Boolean)
      .map(n => ({ projectId, path: n.path, type: n.type, name: n.name }));
    if (!sources.length) return;
    localStorage.setItem('opus:file-clipboard', JSON.stringify({ mode, sources }));
    const c = sources.length;
    const noun = c === 1 ? 'item' : 'items';
    addToast(mode === 'cut' ? `${c} ${noun} cut.` : `${c} ${noun} copied.`);
  }

  function pasteTargetPath() {
    if (!markedNode) return '';
    if (markedNode.type === 'dir') return markedNode.path;
    const idx = markedNode.path.lastIndexOf('/');
    return idx === -1 ? '' : markedNode.path.slice(0, idx);
  }

  function parentPath(node) {
    if (!node?.path) return '';
    const idx = node.path.lastIndexOf('/');
    return idx === -1 ? '' : node.path.slice(0, idx);
  }

  async function pasteClipboard(targetPath = pasteTargetPath()) {
    const payload = getClipboardPayload();
    if (!payload?.sources?.length) return;

    const r = await fetch(`/api/projects/${projectId}/files/paste`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({
        mode: payload.mode === 'cut' ? 'cut' : 'copy',
        sources: payload.sources,
        targetPath,
      }),
    });
    const data = await r.json();
    if (!data.success) {
      addToast(data.error || 'Paste failed.', 'error');
      return;
    }
    if (payload.mode === 'cut') localStorage.removeItem('opus:file-clipboard');
    addToast('Pasted.');
    loadTree();
  }

  useEffect(() => {
    function handleFileTreeShortcut(e) {
      const active = document.activeElement;
      const typing = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || active?.isContentEditable;
      if (typing || !fileTreeRef.current?.contains(active)) return;

      // Delete — remove the current selection (no modifier).
      if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const nodes = operationNodes(markedNode);
        if (!nodes.length) return;
        e.preventDefault();
        removeFileNodes(nodes);
        return;
      }

      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (!['c', 'x', 'v', 'a'].includes(key)) return;

      // Ctrl/Cmd+A — select every visible item in the tree.
      if (key === 'a') {
        if (!visibleOrder.length) return;
        e.preventDefault();
        setSelectedPaths(new Set(visibleOrder));
        return;
      }

      if ((key === 'c' || key === 'x') && !markedNode && selectedPaths.size === 0) return;
      e.preventDefault();
      if (key === 'c') setClipboardPayload('copy', operationNodes(markedNode));
      else if (key === 'x') setClipboardPayload('cut', operationNodes(markedNode));
      else pasteClipboard();
    }

    window.addEventListener('keydown', handleFileTreeShortcut);
    return () => window.removeEventListener('keydown', handleFileTreeShortcut);
  }, [projectId, markedNode, selectedPaths, visibleOrder, nodeByPath, csrfToken]);

  async function loadSessions() {
    const pid = projectId;
    try {
      const r = await fetch(`/api/projects/${pid}/terminals`);
      const d = await r.json();
      // Discard if the user navigated away while this fetch was in flight
      if (currentProjectId.current !== pid) return;
      const sessions = d.sessions || [];
      setTermTabs(sessions.map(s => ({ id: s.id, name: s.name, aiState: s.aiState || 'none' })));
      if (sessions.length > 0) activateTerm(sessions[0].id);
      else createTerminal(pid);
    } catch (_) {}
  }

  function markScrollbackApplied(sessionId) {
    historyReplayed.current.add(sessionId);
  }

  function handleTerminalDisposed(sessionId) {
    joinedSessions.current.delete(sessionId);
    historyReplayed.current.delete(sessionId);
  }

  function activateTerm(sessionId) {
    const tabId = `term-${sessionId}`;
    activeRef.current = tabId;
    setActiveTab(tabId);
    setLastActiveTermId(sessionId);
    const sock = getSocket();

    function doFitFocus() {
      const fitAndSync = (focus) => {
        const ref = termRefs.current[sessionId];
        if (!ref) return;
        ref.fit();
        const s = ref.getSize();
        if (s && sock.connected) sock.emit('terminal:resize', { sessionId, ...s });
        if (focus) ref.focus();
      };
      requestAnimationFrame(() => requestAnimationFrame(() => fitAndSync(true)));
      // Corrective re-fit once the project's layout/fonts have settled, so opening
      // a project never leaves the PTY wider than the visible terminal.
      setTimeout(() => fitAndSync(false), 300);
    }

    function doJoin() {
      const alreadyJoined = joinedSessions.current.has(sessionId);

      if (!alreadyJoined) {
        // First time joining this session — server will send scrollback
        joinedSessions.current.add(sessionId);
        console.log(`[terminal] terminal:join session ${sessionId.slice(0,8)} (will receive scrollback)`);
        sock.emit('terminal:join', { sessionId });
      } else {
        // Already joined this session in this browser session — reattach to live
        // output stream but do NOT replay scrollback (xterm already has the content)
        console.log(`[terminal] terminal:reattach session ${sessionId.slice(0,8)} (no scrollback)`);
        sock.emit('terminal:reattach', { sessionId });
      }
      doFitFocus();
    }

    // Queue until connected if socket isn't ready yet.
    // Do NOT use sock.once('connect', doJoin) in addition to the general onConnect
    // handler — that would cause double joins. Instead, rely solely on the onConnect
    // handler for reconnection, and call doJoin directly when already connected.
    if (sock.connected) {
      doJoin();
    } else {
      // Socket not yet connected on first load. onConnect will fire and call
      // activateTerm for the active session, but we also register once here
      // so the FIRST connection is handled even if activeRef hasn't propagated.
      sock.once('connect', doJoin);
    }
  }

  async function createTerminal(pid = projectId) {
    try {
      const r = await fetch(`/api/projects/${pid}/terminals`, { method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken}, body:'{}' });
      const d = await r.json();
      if (currentProjectId.current !== pid) return;
      if (d.sessionId) {
        setTermTabs(p => [...p, { id: d.sessionId, name: d.name, aiState: 'none' }]);
        setTimeout(() => {
          if (currentProjectId.current === pid) activateTerm(d.sessionId);
        }, 50);
      }
      else addToast(d.error || 'Failed.', 'error');
    } catch (e) { addToast(e.message, 'error'); }
  }

  const [startingWs, setStartingWs] = useState(false);
  async function startWorkspace() {
    setStartingWs(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ action: 'start' }),
      });
      const d = await r.json();
      if (d.success) { addToast('Workspace started.'); await loadProject(); }
      else addToast(d.error || 'Start failed.', 'error');
    } catch (e) { addToast(e.message, 'error'); }
    finally { setStartingWs(false); }
  }

  // Terminal can only attach to a running workspace.
  const wsStopped = project && project.status && project.status !== 'running' && project.status !== 'starting';

  function renderEmptyTerminal() {
    if (wsStopped) {
      return (
        <div className="cockpit-empty">
          <p className="panel-hint" style={{ marginBottom: 12 }}>Workspace is stopped.</p>
          <button className="btn btn-primary" onClick={startWorkspace} disabled={startingWs}>
            {startingWs ? 'Starting…' : 'Start Workspace'}
          </button>
        </div>
      );
    }
    return (
      <div className="cockpit-empty">
        <button className="btn btn-primary" onClick={() => createTerminal()}>Open Terminal</button>
      </div>
    );
  }

  async function openFile(node) {
    const ext = node.name.split('.').pop()?.toLowerCase();
    const images = ['png','jpg','jpeg','gif','svg','webp','ico'];
    if (images.includes(ext)) {
      if (!fileTabs.find(t => t.path === node.path)) setFileTabs(p => [...p, { path: node.path, name: node.name, type: 'image' }]);
      setActiveTab(`file-${node.path}`); activeRef.current = `file-${node.path}`; return;
    }
    if (!fileTabs.find(t => t.path === node.path)) {
      try {
        const r = await fetch(`/api/projects/${projectId}/files/read?path=${encodeURIComponent(node.path)}`);
        const d = await r.json();
        if (d.content !== undefined) {
          setFileContent(p => ({ ...p, [node.path]: d.content }));
          setDirty(p => ({ ...p, [node.path]: false }));
          setFileTabs(p => [...p, { path: node.path, name: node.name, type: 'text' }]);
        }
      } catch { addToast('Could not open file.', 'error'); return; }
    }
    setActiveTab(`file-${node.path}`); activeRef.current = `file-${node.path}`;
    if (isMobile) setMobileTab('terminal');
  }

  async function saveFile(path, contentOverride = fileContent[path] || '', { silent = false } = {}) {
    if (autosaveTimers.current[path]) {
      clearTimeout(autosaveTimers.current[path]);
      delete autosaveTimers.current[path];
    }
    const r = await fetch(`/api/projects/${projectId}/files/write`, { method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken}, body: JSON.stringify({ filePath: path, content: contentOverride }) });
    if ((await r.json()).success) {
      setDirty(p => fileContentRef.current[path] === contentOverride ? { ...p, [path]: false } : p);
    }
    else if (!silent) addToast('Save failed.', 'error');
  }

  function scheduleAutosave(path, content) {
    if (autosaveTimers.current[path]) clearTimeout(autosaveTimers.current[path]);
    autosaveTimers.current[path] = setTimeout(() => {
      delete autosaveTimers.current[path];
      saveFile(path, content, { silent: true }).catch(() => addToast('Autosave failed.', 'error'));
    }, 800);
  }

  function openFileContextMenu(node, x, y) {
    setRenameDialog(null);
    setFileContextMenu({ node, x, y });
  }

  function openRenameDialog(node) {
    setFileContextMenu(null);
    setRenameDialog({ node, value: node.name });
  }

  async function createInNode(node, type) {
    const name = prompt(type === 'dir' ? 'Folder name:' : 'File name:');
    if (!name) return;
    const filePath = node?.type === 'dir' ? `${node.path}/${name}` : name;
    const r = await fetch(`/api/projects/${projectId}/files/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ filePath, type }),
    });
    if ((await r.json()).success) loadTree();
    else addToast('Create failed.', 'error');
  }

  async function createInPath(basePath, type) {
    await createInNode(basePath ? { path: basePath, type: 'dir' } : null, type);
  }

  function triggerUpload(targetPath, label = 'Project Files') {
    uploadTargetRef.current = targetPath || '';
    uploadLabelRef.current = label;
    uploadInputRef.current?.click();
  }

  async function handleUploadInputChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // reset so the same file can be picked again
    if (!files.length) return;
    const target = uploadTargetRef.current;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    try {
      const r = await fetch(
        `/api/projects/${projectId}/files/upload?targetPath=${encodeURIComponent(target)}`,
        { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: fd },
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed.');
      const n = d.uploaded?.length ?? files.length;
      addToast(`Uploaded ${n} file${n === 1 ? '' : 's'} to ${uploadLabelRef.current}.`);
      loadTree();
    } catch (err) {
      addToast(err.message || 'Upload failed.', 'error');
    }
  }

  async function unzipNode(node, targetPath) {
    try {
      const r = await fetch(`/api/projects/${projectId}/files/unzip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ zipPath: node.path, targetPath }),
      });
      const d = await r.json();
      if (d.success) { addToast(`Unpacked “${node.name}”.`); loadTree(); }
      else addToast(d.error || 'Unpack failed.', 'error');
    } catch {
      addToast('Unpack failed.', 'error');
    }
  }

  async function removeFileNodes(nodes) {
    const list = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
    if (!list.length) return;
    const prompt = list.length === 1
      ? `Delete "${list[0].name}"?`
      : `Delete ${list.length} items?`;
    if (!confirm(prompt)) return;

    let failed = 0;
    for (const node of list) {
      const r = await fetch(`/api/projects/${projectId}/files`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ path: node.path }),
      });
      if ((await r.json().catch(() => ({}))).success) {
        // Close any open tabs for the deleted file, or for files inside a deleted folder.
        const prefix = `${node.path}/`;
        const affected = fileTabs.filter(t => t.path === node.path || t.path.startsWith(prefix));
        affected.forEach(t => closeFile(t.path));
      } else {
        failed += 1;
      }
    }
    if (failed) addToast(failed === list.length ? 'Delete failed.' : `${failed} item${failed === 1 ? '' : 's'} could not be deleted.`, 'error');
    clearSelection();
    loadTree();
  }

  async function referenceFileNode(node) {
    try {
      const res = await fetch(`/api/projects/${projectId}/terminals`);
      const data = await res.json();
      const sessions = data.sessions || [];
      if (!sessions.length) { addToast('No terminal sessions open — open a terminal first.', 'error'); return; }
      getSocket().emit('terminal:input', { sessionId: sessions[0].id, data: quoteForTerminal(workspacePath(node)) });
    } catch { addToast('Could not send path to terminal.', 'error'); }
  }

  async function handleFileContextAction(action) {
    const node = fileContextMenu?.node;
    setFileContextMenu(null);

    if (action === 'new-file') await createInNode(node, 'file');
    else if (action === 'new-folder') await createInNode(node, 'dir');
    else if (action === 'upload') triggerUpload(node?.type === 'dir' ? node.path : '', node?.path?.startsWith('.planning') ? 'Planning Files' : 'Project Files');
    else if (action === 'upload-project') triggerUpload('', 'Project Files');
    else if (action === 'upload-planning') triggerUpload('.planning', 'Planning Files');
    else if (action === 'paste') await pasteClipboard(node?.type === 'dir' ? node.path : parentPath(node));
    else if (!node) return;
    else if (action === 'unpack-here') await unzipNode(node, parentPath(node));
    else if (action === 'unpack-folder') {
      const base = node.name.replace(/\.zip$/i, '');
      const parent = parentPath(node);
      await unzipNode(node, parent ? `${parent}/${base}` : base);
    }
    else if (action === 'unpack-to') {
      const dest = prompt('Unpack to folder (relative to project root):', parentPath(node));
      if (dest !== null) await unzipNode(node, dest.trim());
    }
    else if (action === 'rename') openRenameDialog(node);
    else if (action === 'reference') await referenceFileNode(node);
    else if (action === 'copy-path') {
      try { await navigator.clipboard.writeText(workspacePath(node)); }
      catch { addToast('Could not copy path.', 'error'); }
    } else if (action === 'copy') {
      setClipboardPayload('copy', operationNodes(node));
    } else if (action === 'cut') {
      setClipboardPayload('cut', operationNodes(node));
    } else if (action === 'download') {
      window.open(`/api/projects/${projectId}/files/download?path=${encodeURIComponent(node.path)}`);
    } else if (action === 'delete') {
      await removeFileNodes(operationNodes(node));
    }
  }

  async function submitRenameDialog() {
    const node = renameDialog?.node;
    const newName = renameDialog?.value.trim();
    setRenameDialog(null);
    if (!node || !newName || newName === node.name) return;

    const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    const r = await fetch(`/api/projects/${projectId}/files/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ oldPath: node.path, newPath }),
    });
    if ((await r.json()).success) loadTree();
    else addToast('Rename failed.', 'error');
  }

  function closeFile(path) {
    setFileTabs(p => p.filter(t => t.path !== path));
    if (activeTab === `file-${path}`) { const first = termTabs[0]; if (first) activateTerm(first.id); else setActiveTab(null); }
  }

  async function killTerminal(sessionId) {
    await fetch(`/api/projects/${projectId}/terminals/${sessionId}`, { method:'DELETE', headers:{'X-CSRF-Token':csrfToken} });
    setTermTabs(p => p.filter(t => t.id !== sessionId));
    if (activeTab === `term-${sessionId}`) { const other = termTabs.find(t => t.id !== sessionId); if (other) activateTerm(other.id); else setActiveTab(null); }
  }

  async function deleteProject() {
    setDeleting(true);
    try { const r = await fetch(`/api/projects/${projectId}`, { method:'DELETE', headers:{'X-CSRF-Token':csrfToken} }); if (r.ok) navigate('/'); else addToast('Delete failed.','error'); }
    catch { addToast('Delete failed.','error'); }
    finally { setDeleting(false); setShowDelete(false); }
  }

  const activeFileTab = fileTabs.find(t => `file-${t.path}` === activeTab);
  const fileSplitActive = !!activeFileTab && !isMobile;
  const showOverlay = (activeFileTab && isMobile) || activeTab === 'settings' || activeTab === 'git';
  // On mobile, show the active terminal session in the log viewer
  const activeTermId = termTabs.find(t => activeTab === `term-${t.id}`)?.id
    ?? termTabs.find(t => t.id === lastActiveTermId)?.id
    ?? termTabs[0]?.id
    ?? null;

  function mergeTerminalCommand(command) {
    return (command?.commands || [])
      .map(line => String(line || '').trim())
      .filter(Boolean)
      .join(' && ');
  }

  function pasteTerminalCommand(command) {
    const merged = mergeTerminalCommand(command);
    if (!merged) return;
    if (!activeTermId) {
      addToast('Open a terminal first.', 'error');
      return;
    }
    activateTerm(activeTermId);
    getSocket().emit('terminal:input', { sessionId: activeTermId, data: merged });
  }

  function renderActiveFileEditor() {
    if (!activeFileTab) return null;

    if (activeFileTab.type === 'text') {
      return (
        <div className="file-editor" onKeyDown={e => { if ((e.ctrlKey||e.metaKey) && e.key==='s') { e.preventDefault(); saveFile(activeFileTab.path); } }}>
          <div className="file-editor-toolbar">
            <button className="btn btn-ghost" onClick={() => { const t = termTabs.find(tab => tab.id === activeTermId) || termTabs[0]; if (t) activateTerm(t.id); else setActiveTab(null); if (isMobile) setMobileTab('files'); }}>← Files</button>
            <span className="file-editor-name">{activeFileTab.name}</span>
            <button className="btn btn-primary" onClick={() => saveFile(activeFileTab.path)}>Save</button>
          </div>
          <SyntaxHighlightedEditor
            fileName={activeFileTab.name}
            spellCheck={false}
            value={fileContent[activeFileTab.path] || ''}
            onChange={e => {
              const nextContent = e.target.value;
              setFileContent(p=>({...p,[activeFileTab.path]:nextContent}));
              setDirty(p=>({...p,[activeFileTab.path]:true}));
              scheduleAutosave(activeFileTab.path, nextContent);
            }} />
        </div>
      );
    }

    if (activeFileTab.type === 'image') {
      return (
        <div className="file-editor">
          <div className="file-editor-toolbar">
            <button className="btn btn-ghost" onClick={() => { const t = termTabs.find(tab => tab.id === activeTermId) || termTabs[0]; if (t) activateTerm(t.id); if (isMobile) setMobileTab('files'); }}>← Files</button>
            <span className="file-editor-name">{activeFileTab.name}</span>
          </div>
          <div className="file-image-pane">
            <img src={`/api/projects/${projectId}/files/read?path=${encodeURIComponent(activeFileTab.path)}`} alt={activeFileTab.name} />
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <div className="cockpit" data-mobile-tab={mobileTab}>
      {/* File tree — collapsible */}
      <div
        ref={fileTreePanelRef}
        className={`cockpit-filetree${treeCollapsed ? ' collapsed' : ''}${resizingTree ? ' resizing' : ''}`}
        style={treeCollapsed ? undefined : { width: treeWidth, minWidth: treeWidth }}
      >
        <div className="filetree-header">
          {!treeCollapsed && (
            <div className="filetree-project"
                 onMouseEnter={() => setHoveredTreeProject(true)}
                 onMouseLeave={() => setHoveredTreeProject(false)}>
              {project && <ProjectAvatar project={project} size={24} playing={hoveredTreeProject} />}
              <span className="filetree-project-name">{project?.name}</span>
            </div>
          )}
          <div className="filetree-actions">
            <button className="ft-btn ft-collapse-btn" title={treeCollapsed ? 'Expand files' : 'Collapse files'} onClick={() => setTreeCollapsed(c => !c)}>
              {treeCollapsed ? '›' : '‹'}
            </button>
          </div>
        </div>
        <div
          className="filetree-scroll"
          ref={fileTreeRef}
          tabIndex={0}
          onContextMenu={e => {
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            openFileContextMenu(null, e.clientX, e.clientY);
          }}
          onClick={e => {
            if (e.target === e.currentTarget) clearSelection();
          }}
        >
          <div
            className="filetree-section"
            onContextMenu={e => {
              e.preventDefault();
              e.stopPropagation();
              openFileContextMenu({ name: 'Planning Files', path: '.planning', type: 'dir' }, e.clientX, e.clientY);
            }}
          >
            <div className="filetree-section-header">
              <div className="filetree-section-title">Planning Files</div>
              <div className="filetree-section-actions">
                <button className="ft-btn ft-icon-btn" title="New planning file" aria-label="New planning file" onClick={() => createInPath('.planning', 'file')}><NewFileIcon /></button>
                <button className="ft-btn ft-icon-btn" title="New planning folder" aria-label="New planning folder" onClick={() => createInPath('.planning', 'dir')}><NewFolderIcon /></button>
                <button className="ft-btn ft-icon-btn" title="Upload to Planning Files" aria-label="Upload to Planning Files" onClick={() => triggerUpload('.planning', 'Planning Files')}><UploadIcon /></button>
              </div>
            </div>
            {planningTree.length === 0 && <p className="filetree-empty filetree-empty-section">Empty</p>}
            {planningTree.map(n => (
              <FileNode
                key={n.path}
                node={n}
                depth={0}
                onOpenFile={openFile}
                activeFilePath={activeFileTab?.path}
                onOpenContextMenu={openFileContextMenu}
                onOpenRenameDialog={openRenameDialog}
                selectedPaths={selectedPaths}
                onSelectNode={selectNode}
                onContextSelect={contextSelectNode}
                expandedPaths={expandedPaths}
                onToggleFolder={toggleFolder}
              />
            ))}
          </div>
          <div
            className="filetree-section"
            onContextMenu={e => {
              e.preventDefault();
              e.stopPropagation();
              openFileContextMenu(null, e.clientX, e.clientY);
            }}
          >
            <div className="filetree-section-header">
              <div className="filetree-section-title">Project Files</div>
              <div className="filetree-section-actions">
                <button className="ft-btn ft-icon-btn" title="New project file" aria-label="New project file" onClick={() => createInPath('', 'file')}><NewFileIcon /></button>
                <button className="ft-btn ft-icon-btn" title="New project folder" aria-label="New project folder" onClick={() => createInPath('', 'dir')}><NewFolderIcon /></button>
                <button className="ft-btn ft-icon-btn" title="Upload to Project Files" aria-label="Upload to Project Files" onClick={() => triggerUpload('', 'Project Files')}><UploadIcon /></button>
              </div>
            </div>
            {tree.length === 0 && <p className="filetree-empty filetree-empty-section">Empty project</p>}
          {tree.map(n => (
            <FileNode
              key={n.path}
              node={n}
              depth={0}
              onOpenFile={openFile}
              activeFilePath={activeFileTab?.path}
              onOpenContextMenu={openFileContextMenu}
              onOpenRenameDialog={openRenameDialog}
              selectedPaths={selectedPaths}
              onSelectNode={selectNode}
              onContextSelect={contextSelectNode}
              expandedPaths={expandedPaths}
              onToggleFolder={toggleFolder}
            />
          ))}
          </div>
        </div>
        {!treeCollapsed && (
          <div
            className="filetree-resize-handle"
            onMouseDown={startResizeFileTree}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize file tree"
          />
        )}
      </div>

      {/* Main */}
      <div className="cockpit-main" ref={cockpitMainRef}>
        {/* Tab bar */}
        <div className="cockpit-tabs" role="tablist">
          {/* Terminal tabs */}
          {termTabs.map(t => (
            <div key={t.id} className={`cockpit-tab${activeTab === `term-${t.id}` ? ' active' : ''}${t.aiState === 'waiting' ? ' ai-waiting' : t.aiState === 'active' ? ' ai-active' : ''}`}
              role="tab" onClick={() => activateTerm(t.id)}>
              <span className="tab-icon">⌨</span>
              <span className="tab-label">{t.name}</span>
              {t.aiState === 'waiting' && <span className="tab-ai-badge badge-ai" style={{fontSize:9,height:14,padding:'0 4px'}}>!</span>}
              <button className="tab-close" onClick={e => { e.stopPropagation(); killTerminal(t.id); }}>×</button>
            </div>
          ))}
          <button className="cockpit-new-term" onClick={() => createTerminal()}>+ Terminal</button>
          <button
            type="button"
            className={`cockpit-command-trigger${commandMenu ? ' open' : ''}`}
            onClick={e => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setCommandMenu(open => open ? null : { x: rect.left, y: rect.bottom + 4 });
            }}
            aria-label="Command"
            aria-haspopup="menu"
            aria-expanded={!!commandMenu}
            title="Paste a saved command into the active terminal"
            disabled={!terminalCommands.length}
          >
            <span>Command</span>
            <span className="cockpit-command-chevron" aria-hidden="true">⌄</span>
          </button>
          <div
            className="cockpit-tab files-tab"
            role="tab"
            onClick={() => {
              setTreeCollapsed(false);
              if (isMobile) setMobileTab('files');
            }}
          >
            <span className="tab-icon">▤</span>
            <span className="tab-label">Files</span>
          </div>

          {/* File tabs */}
          {fileTabs.length > 0 && <div className="tab-divider" />}
          {fileTabs.map(t => (
            <div key={t.path} className={`cockpit-tab file-tab${activeTab === `file-${t.path}` ? ' active' : ''}`}
              role="tab"
              onClick={() => { setActiveTab(`file-${t.path}`); activeRef.current = `file-${t.path}`; }}
              onMouseDown={e => {
                if (e.button === 1) e.preventDefault();
              }}
              onAuxClick={e => {
                if (e.button !== 1) return;
                e.preventDefault();
                closeFile(t.path);
              }}>
              <span className="tab-icon">📄</span>
              <span className="tab-label">{t.name}{dirtyFiles[t.path] ? ' ·' : ''}</span>
              <button className="tab-close" onClick={e => { e.stopPropagation(); closeFile(t.path); }}>×</button>
            </div>
          ))}

          {/* Panel tabs (right-aligned) */}
          <div className="tabs-spacer" />
          <button className={`cockpit-panel-tab${tasksOpen ? ' active' : ''}`} onClick={toggleTasksPanel}>Tasks</button>
          <button className={`cockpit-panel-tab${activeTab === 'git' ? ' active' : ''}`} onClick={() => { setTasksOpen(false); setActiveTab('git'); activeRef.current = 'git'; }}>Git</button>
          <button className={`cockpit-panel-tab${activeTab === 'settings' ? ' active' : ''}`} onClick={() => { setTasksOpen(false); setActiveTab('settings'); activeRef.current = 'settings'; }}>Workspace</button>
        </div>

        {/* Content */}
        <div className={`cockpit-content${fileSplitActive || tasksOpen ? ' file-split-active' : ''}${resizingFilePanel ? ' resizing-file-panel' : ''}`}>
          {/*
            Terminals layer is ALWAYS rendered and takes full space.
            Files/panels overlay on top using position:absolute.
            This keeps terminal dims stable so FitAddon never measures 0×0.
          */}
          <div
            className="terminals-layer"
          >
            {isMobile ? (
              /* Mobile: read-only log viewer — never mounts xterm, never resizes PTY.
                 A compact tab strip lets you switch between, add, and close
                 terminals (the desktop .cockpit-tabs bar is hidden on mobile). */
              activeTermId ? (
                <div className="mtv-shell">
                  <MobileTermTabs
                    tabs={termTabs}
                    activeId={activeTermId}
                    onSelect={activateTerm}
                    onAdd={() => createTerminal()}
                    onClose={killTerminal}
                  />
                  <div className="mtv-shell-body">
                    <MobileTerminalView key={activeTermId} sessionId={activeTermId} />
                  </div>
                </div>
              ) : (
                renderEmptyTerminal()
              )
            ) : (
              /* Desktop: full interactive xterm — owns PTY resize */
              <>
                {termTabs.map(t => (
                  <TerminalInstance
                    key={t.id}
                    sessionId={t.id}
                    active={activeTab === `term-${t.id}` || (fileSplitActive && t.id === activeTermId)}
                    termRefs={termRefs}
                    pendingScrollback={pendingScrollback}
                    onScrollbackApplied={markScrollbackApplied}
                    onTerminalDisposed={handleTerminalDisposed}
                    projectId={projectId}
                    csrfToken={csrfToken}
                    addToast={addToast}
                    lastInputRef={lastInputRef}
                  />
                ))}
                {termTabs.length === 0 && !showOverlay && renderEmptyTerminal()}
              </>
            )}
            {reconnecting && (
              <div className="terminal-reconnect-overlay">
                {reconSecs > 5 ? `Connection lost. Retrying… ${reconSecs}s` : 'Reconnecting…'}
              </div>
            )}
          </div>

          {fileSplitActive && (
            <>
              <div
                className="file-panel-resize-handle"
                onMouseDown={startResizeFilePanel}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize file editor"
              />
              <div className="file-split-pane" style={{ width: filePanelWidth }}>
                {renderActiveFileEditor()}
              </div>
            </>
          )}

          {/* Overlay: file editor, image viewer, or panel — sits on top of terminals */}
          {showOverlay && (
            <div className="content-overlay">
              {/* File editor */}
              {activeFileTab?.type === 'text' && renderActiveFileEditor()}

              {/* Image viewer */}
              {activeFileTab?.type === 'image' && renderActiveFileEditor()}

              {/* Workspace settings panel */}
              {activeTab === 'settings' && (
                <div className="side-panel">
                  <div className="side-panel-header">WORKSPACE</div>
                  <WorkspacePanel
                    projectId={projectId}
                    project={project}
                    csrfToken={csrfToken}
                    addToast={addToast}
                    onDelete={() => setShowDelete(true)}
                    onProjectUpdated={updated => setProject(prev => ({ ...prev, ...updated }))}
                  />
                </div>
              )}

              {/* Git panel */}
              {activeTab === 'git' && <GitPage />}
            </div>
          )}

          {tasksOpen && (
            <div className="tasks-drawer">
              <div className="side-panel-header">TASKS</div>
              <TasksPanel
                tasks={tasks}
                taskSections={taskSections}
                taskDraft={taskDraft}
                taskSectionDraft={taskSectionDraft}
                completedOpen={completedTasksOpen}
                planningTree={planningTree}
                onDraftChange={setTaskDraft}
                onSectionDraftChange={setTaskSectionDraft}
                onAddTask={addTask}
                onAddSection={addTaskSection}
                onDeleteSection={deleteTaskSection}
                onRenameSection={renameTaskSection}
                onToggleTask={toggleTask}
                onDeleteTask={deleteTask}
                onEditTask={setEditingTaskId}
                editingTaskId={editingTaskId}
                onCloseTaskEditor={() => setEditingTaskId(null)}
                onSaveTask={saveTask}
                onMoveTask={moveTask}
                onToggleCompleted={() => setCompletedTasksOpen(open => !open)}
                onOpenLinkedPlanningFile={openLinkedPlanningFile}
              />
            </div>
          )}
        </div>
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleUploadInputChange}
      />

      {fileContextMenu && (() => {
        // When the right-clicked node is part of a multi-selection, the menu's
        // Copy/Cut/Delete act on the whole selection — reflect that in the labels.
        const ctxCount = fileContextMenu.node && selectedPaths.has(fileContextMenu.node.path) && selectedPaths.size > 1
          ? selectedPaths.size : 1;
        const ctxSuffix = ctxCount > 1 ? ` ${ctxCount} items` : '';
        return (
        <ContextMenuPortal
          x={fileContextMenu.x}
          y={fileContextMenu.y}
          className="context-menu"
          onClick={e => e.stopPropagation()}
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {(!fileContextMenu.node || fileContextMenu.node.type === 'dir') && <button role="menuitem" onClick={() => handleFileContextAction('new-file')}>New File</button>}
          {(!fileContextMenu.node || fileContextMenu.node.type === 'dir') && <button role="menuitem" onClick={() => handleFileContextAction('new-folder')}>New Folder</button>}
          {(!fileContextMenu.node || fileContextMenu.node.type === 'dir') && <button role="menuitem" onClick={() => handleFileContextAction('upload')}>Upload Files…</button>}
          {!fileContextMenu.node && <button role="menuitem" onClick={() => handleFileContextAction('upload-project')}>Upload to Project Files</button>}
          {!fileContextMenu.node && <button role="menuitem" onClick={() => handleFileContextAction('upload-planning')}>Upload to Planning Files</button>}
          <button role="menuitem" onClick={() => handleFileContextAction('paste')}>Paste</button>
          {fileContextMenu.node?.type === 'file' && fileContextMenu.node.name.toLowerCase().endsWith('.zip') && <>
            <div className="context-separator" />
            <button role="menuitem" onClick={() => handleFileContextAction('unpack-here')}>Unpack here</button>
            <button role="menuitem" onClick={() => handleFileContextAction('unpack-folder')}>Unpack to “{fileContextMenu.node.name.replace(/\.zip$/i, '')}/”</button>
            <button role="menuitem" onClick={() => handleFileContextAction('unpack-to')}>Unpack…</button>
          </>}
          {fileContextMenu.node && <div className="context-separator" />}
          {fileContextMenu.node && !isPlanningRootNode(fileContextMenu.node) && <button role="menuitem" onClick={() => handleFileContextAction('rename')}>Rename</button>}
          {fileContextMenu.node && <button role="menuitem" onClick={() => handleFileContextAction('reference')}>Reference</button>}
          {fileContextMenu.node && <button role="menuitem" onClick={() => handleFileContextAction('copy-path')}>Copy Path</button>}
          {fileContextMenu.node && !isPlanningRootNode(fileContextMenu.node) && <button role="menuitem" onClick={() => handleFileContextAction('copy')}>{`Copy${ctxSuffix}`}</button>}
          {fileContextMenu.node && !isPlanningRootNode(fileContextMenu.node) && <button role="menuitem" onClick={() => handleFileContextAction('cut')}>{`Cut${ctxSuffix}`}</button>}
          {fileContextMenu.node?.type !== 'dir' && fileContextMenu.node && ctxCount === 1 && <button role="menuitem" onClick={() => handleFileContextAction('download')}>Download</button>}
          {fileContextMenu.node && !isPlanningRootNode(fileContextMenu.node) && <div className="context-separator" />}
          {fileContextMenu.node && !isPlanningRootNode(fileContextMenu.node) && <button role="menuitem" className="context-danger" onClick={() => handleFileContextAction('delete')}>{`Delete${ctxSuffix}`}</button>}
        </ContextMenuPortal>
        );
      })()}

      {commandMenu && (
        <ContextMenuPortal
          x={commandMenu.x}
          y={commandMenu.y}
          className="context-menu command-menu"
          onClick={e => e.stopPropagation()}
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className="command-menu-label">Command</div>
          {terminalCommands.map(command => (
            <button
              key={command.id}
              type="button"
              role="menuitem"
              onClick={() => {
                pasteTerminalCommand(command);
                setCommandMenu(null);
              }}
            >
              <span className="command-menu-name">{command.displayName}</span>
            </button>
          ))}
        </ContextMenuPortal>
      )}

      {renameDialog && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setRenameDialog(null)}>
          <form
            className="modal rename-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-modal-title"
            onSubmit={e => {
              e.preventDefault();
              submitRenameDialog();
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setRenameDialog(null);
              }
            }}
          >
            <div className="modal-header">
              <h2 className="modal-title" id="rename-modal-title">Rename</h2>
            </div>
            <div className="modal-body">
              <label className="rename-modal-label" htmlFor="rename-file-input">Name</label>
              <input
                id="rename-file-input"
                ref={renameInputRef}
                className="rename-modal-input"
                value={renameDialog.value}
                onChange={e => setRenameDialog(d => d ? { ...d, value: e.target.value } : d)}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setRenameDialog(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Rename</button>
            </div>
          </form>
        </div>
      )}

      {/* Delete modal */}
      {showDelete && (
        <div className="modal-backdrop" onClick={e => !deleting && e.target === e.currentTarget && setShowDelete(false)}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-header"><h2 className="modal-title">Delete project?</h2></div>
            <div className="modal-body">
              <p style={{ fontSize:'var(--font-size-sm)', color:'var(--color-text-secondary)', lineHeight:'var(--leading-normal)' }}>
                Removes the workspace container and home volume.<br/>
                <strong>Project files on disk are not deleted.</strong>
              </p>
              {deleting && <div className="delete-loading"><span className="delete-spinner" />Removing workspace…</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowDelete(false)} disabled={deleting}>Cancel</button>
              <button className="btn btn-danger" onClick={deleteProject} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete Project'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
