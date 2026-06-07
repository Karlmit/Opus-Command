import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import './Git.css';

const BRANCH_COLORS = ['#3B82F6', '#A78BFA', '#34D399', '#F59E0B', '#F472B6', '#60A5FA', '#FB923C'];
function branchColor(idx) { return BRANCH_COLORS[idx % BRANCH_COLORS.length]; }

function parseRefs(refsStr) {
  if (!refsStr) return [];
  return refsStr.split(',').map(r => r.trim()).filter(Boolean);
}

function classifyRef(ref) {
  if (ref.startsWith('HEAD -> ')) return { type: 'head', display: ref.slice(8) };
  if (ref === 'HEAD') return { type: 'detached', display: 'HEAD' };
  if (ref.startsWith('tag: ')) return { type: 'tag', display: ref.slice(5) };
  if (ref.startsWith('origin/') || ref.includes('/')) return { type: 'remote', display: ref };
  return { type: 'branch', display: ref };
}

function parseDiffLines(diffText) {
  const lines = diffText.split('\n');
  let oldLine = 0, newLine = 0;
  return lines.map(line => {
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldLine = parseInt(m[1]); newLine = parseInt(m[2]); }
      return { type: 'hunk', text: line, oldLine: null, newLine: null };
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) {
      return { type: 'meta', text: line, oldLine: null, newLine: null };
    }
    if (line.startsWith('+')) {
      return { type: 'added', text: line.slice(1), oldLine: null, newLine: newLine++ };
    }
    if (line.startsWith('-')) {
      return { type: 'removed', text: line.slice(1), oldLine: oldLine++, newLine: null };
    }
    const o = oldLine++, n = newLine++;
    return { type: 'context', text: line.slice(1) || line, oldLine: o, newLine: n };
  });
}

function formatTs(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function BranchIcon() {
  return (
    <svg className="gk-branch-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="6" y1="3" x2="6" y2="15"/>
      <circle cx="18" cy="6" r="3"/>
      <circle cx="6" cy="18" r="3"/>
      <path d="M18 9a9 9 0 0 1-9 9"/>
    </svg>
  );
}

function StatusDot({ status }) {
  const s = (status || '?').trim();
  const map = {
    M:  { cls: 'st-modified',  char: 'M' },
    A:  { cls: 'st-added',     char: 'A' },
    D:  { cls: 'st-deleted',   char: 'D' },
    R:  { cls: 'st-renamed',   char: 'R' },
    '??': { cls: 'st-untracked', char: '?' },
    '?':  { cls: 'st-untracked', char: '?' },
  };
  const info = map[s] || { cls: 'st-untracked', char: s };
  return <span className={`gk-status-dot ${info.cls}`}>{info.char}</span>;
}

function FileRow({ file, staged, onStage, onRevert, onSelectDiff, selectedDiff }) {
  const [confirmRevert, setConfirmRevert] = useState(false);
  const isSelected = selectedDiff === file.path;
  const parts = file.path.split('/');
  const fileName = parts.pop();
  const dir = parts.join('/');

  function handleRevert(e) {
    e.stopPropagation();
    if (confirmRevert) { onRevert(file.path); setConfirmRevert(false); }
    else { setConfirmRevert(true); setTimeout(() => setConfirmRevert(false), 3000); }
  }

  return (
    <div className={`gk-file-row${isSelected ? ' selected' : ''}`} onClick={() => onSelectDiff(file.path)}>
      <input
        type="checkbox"
        checked={staged}
        onChange={e => { e.stopPropagation(); onStage(file.path, !staged); }}
        onClick={e => e.stopPropagation()}
        className="gk-checkbox"
      />
      <StatusDot status={file.status} />
      <span className="gk-file-path">
        {dir && <span className="gk-file-dir">{dir}/</span>}
        <span className="gk-file-name">{fileName}</span>
      </span>
      <button
        className={`gk-revert-btn${confirmRevert ? ' confirming' : ''}`}
        onClick={handleRevert}
        title={confirmRevert ? 'Confirm revert?' : 'Revert changes'}
      >
        {confirmRevert ? 'Revert?' : '↩'}
      </button>
    </div>
  );
}

function DiffViewer({ diff, filePath }) {
  if (!diff || !filePath) {
    return (
      <div className="gk-diff-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
          <line x1="9" y1="11" x2="11" y2="11"/>
        </svg>
        <span>Select a file to view its diff</span>
      </div>
    );
  }

  const lines = parseDiffLines(diff);

  return (
    <div className="gk-diff-view">
      <div className="gk-diff-header">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span className="gk-diff-filename">{filePath}</span>
      </div>
      <div className="gk-diff-content">
        {lines.map((line, i) => (
          <div key={i} className={`gk-diff-line gk-diff-${line.type}`}>
            <span className="gk-diff-ln">{line.oldLine ?? ''}</span>
            <span className="gk-diff-ln">{line.newLine ?? ''}</span>
            <span className="gk-diff-sign">
              {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ''}
            </span>
            <code className="gk-diff-code">{line.text}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommitHistory({ log }) {
  if (!log || log.length === 0) {
    return (
      <div className="gk-history-empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <circle cx="12" cy="12" r="4"/>
          <line x1="12" y1="2" x2="12" y2="8"/>
          <line x1="12" y1="16" x2="12" y2="22"/>
        </svg>
        <span>No commits yet</span>
      </div>
    );
  }

  return (
    <div className="gk-history">
      {log.map((commit, i) => {
        const refs = parseRefs(commit.refs);
        const color = branchColor(i === 0 ? 0 : i);
        const isHead = refs.some(r => r.startsWith('HEAD'));

        return (
          <div key={commit.hash || i} className={`gk-commit-row${isHead ? ' is-head' : ''}`}>
            <div className="gk-graph-col">
              {i < log.length - 1 && (
                <div className="gk-rail" style={{ '--rc': color }} />
              )}
              <div
                className="gk-dot"
                style={{
                  background: color,
                  boxShadow: isHead ? `0 0 0 2px var(--color-background), 0 0 8px ${color}60` : `0 0 0 2px var(--color-background)`,
                }}
              />
            </div>
            <div className="gk-commit-info">
              <div className="gk-commit-top">
                <code className="gk-hash">{commit.shortHash}</code>
                {refs.map(r => {
                  const c = classifyRef(r);
                  return (
                    <span key={r} className={`gk-ref gk-ref-${c.type}`}>
                      {c.type === 'head' ? '⎇ ' : ''}{c.display}
                    </span>
                  );
                })}
              </div>
              <div className="gk-subject">{commit.subject}</div>
              <div className="gk-meta">
                <span>{commit.author}</span>
                <span className="gk-dot-sep">·</span>
                <span>{commit.relativeDate}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SnapshotRow({ snapshot, onRestore }) {
  const [showConfirm, setShowConfirm] = useState(false);
  return (
    <div className="gk-snapshot-row">
      <div className="gk-snapshot-info">
        <span className="gk-snapshot-tag">{snapshot.tag.replace('snapshot/', '')}</span>
        {snapshot.label && <span className="gk-snapshot-label">{snapshot.label}</span>}
        <span className="gk-snapshot-time">{formatTs(snapshot.date)}</span>
      </div>
      {showConfirm ? (
        <div className="gk-snapshot-confirm">
          <button className="btn btn-danger" style={{ height: 24, fontSize: 11, padding: '0 8px' }} onClick={() => { onRestore(snapshot.tag); setShowConfirm(false); }}>Restore</button>
          <button className="btn btn-ghost" style={{ height: 24, fontSize: 11, padding: '0 6px' }} onClick={() => setShowConfirm(false)}>✕</button>
        </div>
      ) : (
        <button className="gk-link-btn" onClick={() => setShowConfirm(true)}>Restore</button>
      )}
    </div>
  );
}

export default function GitPage() {
  const { id: projectId } = useParams();
  const { csrfToken } = useAuth();
  const { addToast } = useToast();

  const [status, setStatus] = useState(null);
  const [staged, setStaged] = useState(new Set());
  const [commitMessage, setCommitMessage] = useState('');
  const [selectedDiff, setSelectedDiff] = useState(null);
  const [diff, setDiff] = useState('');
  const [snapshots, setSnapshots] = useState([]);
  const [log, setLog] = useState([]);
  const [remote, setRemote] = useState(null);
  const [newBranch, setNewBranch] = useState('');
  const [showBranch, setShowBranch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [rightPanel, setRightPanel] = useState('diff');
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);

  useEffect(() => {
    loadAll();
    const iv = setInterval(loadStatus, 3000);
    return () => clearInterval(iv);
  }, [projectId]);

  async function loadAll() {
    await Promise.all([loadStatus(), loadSnapshots(), loadLog(), loadRemote()]);
  }

  async function loadStatus() {
    try {
      const res = await fetch(`/api/projects/${projectId}/git/status`);
      const data = await res.json();
      setStatus(data);
    } catch (_) {}
    finally { setLoading(false); }
  }

  async function loadSnapshots() {
    try {
      const res = await fetch(`/api/projects/${projectId}/git/snapshots`);
      const data = await res.json();
      setSnapshots(data.snapshots || []);
    } catch (_) {}
  }

  async function loadLog() {
    try {
      const res = await fetch(`/api/projects/${projectId}/git/log`);
      const data = await res.json();
      setLog(data.commits || []);
    } catch (_) {}
  }

  async function loadRemote() {
    try {
      const res = await fetch(`/api/projects/${projectId}/git/remote`);
      const data = await res.json();
      setRemote(data);
    } catch (_) {}
  }

  async function handleStage(filePath, doStage) {
    await fetch(`/api/projects/${projectId}/git/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ files: [filePath], unstage: !doStage }),
    });
    setStaged(prev => {
      const next = new Set(prev);
      if (doStage) next.add(filePath); else next.delete(filePath);
      return next;
    });
  }

  async function handleSelectDiff(filePath) {
    setSelectedDiff(filePath);
    setRightPanel('diff');
    try {
      const res = await fetch(`/api/projects/${projectId}/git/diff?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      setDiff(data.diff || '');
    } catch { setDiff(''); }
  }

  async function handleCommit() {
    if (!commitMessage.trim()) { addToast('Commit message required.', 'error'); return; }
    const res = await fetch(`/api/projects/${projectId}/git/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ message: commitMessage }),
    });
    const data = await res.json();
    if (data.success) {
      setCommitMessage(''); setStaged(new Set());
      addToast('Committed.');
      await Promise.all([loadStatus(), loadLog()]);
    } else { addToast(data.error || 'Commit failed.', 'error'); }
  }

  async function handleRevert(filePath) {
    const res = await fetch(`/api/projects/${projectId}/git/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ filePath }),
    });
    const data = await res.json();
    if (data.success) { loadStatus(); addToast('File reverted.'); }
    else addToast(data.error || 'Revert failed.', 'error');
  }

  async function handleRevertAll() {
    if (!confirm('Revert all changes? This cannot be undone.')) return;
    const res = await fetch(`/api/projects/${projectId}/git/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ all: true }),
    });
    const data = await res.json();
    if (data.success) { loadStatus(); addToast('All changes reverted.'); }
    else addToast(data.error || 'Revert failed.', 'error');
  }

  async function handleSnapshot() {
    const label = prompt('Snapshot label (optional):') ?? undefined;
    if (label === null) return;
    const res = await fetch(`/api/projects/${projectId}/git/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ label }),
    });
    const data = await res.json();
    if (data.success) { addToast(`Snapshot: ${data.tag}`); loadSnapshots(); }
    else addToast(data.error || 'Snapshot failed.', 'error');
  }

  async function handleCreateBranch() {
    if (!newBranch.trim()) return;
    const res = await fetch(`/api/projects/${projectId}/git/branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ name: newBranch.trim() }),
    });
    const data = await res.json();
    if (data.success) { setNewBranch(''); setShowBranch(false); loadStatus(); addToast(`Switched to ${data.branch}.`); }
    else addToast(data.error || 'Branch creation failed.', 'error');
  }

  async function handleRestore(tag) {
    const res = await fetch(`/api/projects/${projectId}/git/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ tag }),
    });
    const data = await res.json();
    if (data.success) { addToast(`Restored to ${tag}`); loadStatus(); }
    else addToast(data.error || 'Restore failed.', 'error');
  }

  async function handleFetch() {
    setFetching(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/git/fetch`, {
        method: 'POST', headers: { 'X-CSRF-Token': csrfToken },
      });
      const data = await res.json();
      if (data.success) { addToast('Fetched.'); await Promise.all([loadRemote(), loadLog()]); }
      else addToast(data.error || 'Fetch failed.', 'error');
    } finally { setFetching(false); }
  }

  async function handlePull() {
    setPulling(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/git/pull`, {
        method: 'POST', headers: { 'X-CSRF-Token': csrfToken },
      });
      const data = await res.json();
      if (data.success) { addToast('Pulled successfully.'); await loadAll(); }
      else addToast(data.error || 'Pull failed.', 'error');
    } finally { setPulling(false); }
  }

  async function handlePush() {
    setPushing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/git/push`, {
        method: 'POST', headers: { 'X-CSRF-Token': csrfToken },
      });
      const data = await res.json();
      if (data.success) { addToast('Pushed successfully.'); await loadRemote(); }
      else addToast(data.error || 'Push failed.', 'error');
    } finally { setPushing(false); }
  }

  if (loading) {
    return (
      <div className="gk-loading">
        <div className="gk-spinner" />
        Loading repository…
      </div>
    );
  }

  if (!status?.initialized) {
    return (
      <div className="gk-uninit">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <circle cx="12" cy="5" r="3"/>
          <circle cx="5" cy="19" r="3"/>
          <circle cx="19" cy="19" r="3"/>
          <line x1="12" y1="8" x2="5" y2="16"/>
          <line x1="12" y1="8" x2="19" y2="16"/>
        </svg>
        <h3>Not a Git repository</h3>
        <p>Run <code>git init</code> in the terminal to get started.</p>
      </div>
    );
  }

  const unstagedFiles = (status.files || []).filter(f => !staged.has(f.path));
  const stagedFiles = (status.files || []).filter(f => staged.has(f.path));
  const anyOp = fetching || pulling || pushing;

  return (
    <div className="gk-page">

      {/* ── Toolbar ── */}
      <div className="gk-toolbar">
        <div className="gk-toolbar-left">
          <div className="gk-branch-pill">
            <BranchIcon />
            <span className="gk-branch-name">{status.branch}</span>
          </div>

          {remote?.hasRemote && (
            <div className="gk-remote-strip">
              {remote.behind > 0 && (
                <span className="gk-sync-pill behind">↓{remote.behind}</span>
              )}
              {remote.ahead > 0 && (
                <span className="gk-sync-pill ahead">↑{remote.ahead}</span>
              )}
              <button className={`gk-remote-btn${fetching ? ' busy' : ''}`} onClick={handleFetch} disabled={anyOp} title="Fetch from remote">
                {fetching ? <span className="gk-btn-spinner" /> : null}
                Fetch
              </button>
              <button className={`gk-remote-btn${pulling ? ' busy' : ''}`} onClick={handlePull} disabled={anyOp} title="Pull from remote">
                {pulling ? <span className="gk-btn-spinner" /> : null}
                Pull
              </button>
              <button className={`gk-remote-btn push${pushing ? ' busy' : ''}`} onClick={handlePush} disabled={anyOp} title="Push to remote">
                {pushing ? <span className="gk-btn-spinner" /> : null}
                Push
              </button>
            </div>
          )}
        </div>

        <div className="gk-toolbar-right">
          <button className="gk-action-btn" onClick={() => setShowBranch(s => !s)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Branch
          </button>
          <button className="gk-action-btn" onClick={handleSnapshot}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            Snapshot
          </button>
        </div>
      </div>

      {/* ── New branch form ── */}
      {showBranch && (
        <div className="gk-branch-form">
          <input
            className="input"
            placeholder="new-branch-name"
            value={newBranch}
            onChange={e => setNewBranch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateBranch(); if (e.key === 'Escape') setShowBranch(false); }}
            autoFocus
            style={{ maxWidth: 240 }}
          />
          <button className="btn btn-primary" onClick={handleCreateBranch}>Create &amp; Switch</button>
          <button className="btn btn-ghost" onClick={() => setShowBranch(false)}>Cancel</button>
        </div>
      )}

      {/* ── Main body ── */}
      <div className="gk-body">

        {/* Left: Changes + Commit + Snapshots */}
        <div className="gk-left">

          {/* Section header */}
          <div className="gk-section-head">
            <span className="gk-section-label">CHANGES</span>
            {(status.files?.length > 0) && (
              <span className="gk-count-pill">{status.files.length}</span>
            )}
            {(status.files?.length > 0) && (
              <button className="gk-link-btn danger" onClick={handleRevertAll}>Revert All</button>
            )}
          </div>

          {/* File list */}
          <div className="gk-changes-list">
            {status.clean ? (
              <div className="gk-empty-state">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Working tree clean
              </div>
            ) : (
              <>
                {unstagedFiles.length > 0 && (
                  <div className="gk-group">
                    <div className="gk-group-header">
                      <span>UNSTAGED</span>
                      <span className="gk-count">{unstagedFiles.length}</span>
                      <button className="gk-link-btn" onClick={() => unstagedFiles.forEach(f => handleStage(f.path, true))}>Stage All</button>
                    </div>
                    {unstagedFiles.map(f => (
                      <FileRow key={f.path} file={f} staged={false} onStage={handleStage} onRevert={handleRevert} onSelectDiff={handleSelectDiff} selectedDiff={selectedDiff} />
                    ))}
                  </div>
                )}

                {stagedFiles.length > 0 && (
                  <div className="gk-group">
                    <div className="gk-group-header">
                      <span>STAGED</span>
                      <span className="gk-count">{stagedFiles.length}</span>
                      <button className="gk-link-btn" onClick={() => stagedFiles.forEach(f => handleStage(f.path, false))}>Unstage All</button>
                    </div>
                    {stagedFiles.map(f => (
                      <FileRow key={f.path} file={f} staged={true} onStage={handleStage} onRevert={handleRevert} onSelectDiff={handleSelectDiff} selectedDiff={selectedDiff} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Commit box */}
          <div className="gk-commit-box">
            <textarea
              className="gk-commit-msg"
              placeholder={`Message (Ctrl+Enter to commit to ${status.branch})`}
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCommit(); }}
            />
            <button
              className="gk-commit-btn"
              onClick={handleCommit}
              disabled={stagedFiles.length === 0 || !commitMessage.trim()}
            >
              Commit to <strong>{status.branch}</strong>
            </button>
          </div>

          {/* Snapshots */}
          <div className="gk-snapshots-section">
            <button className="gk-section-head collapsible" onClick={() => setSnapshotsOpen(o => !o)}>
              <span className="gk-section-label">SNAPSHOTS</span>
              <span className="gk-count-pill">{snapshots.length}</span>
              <span className="gk-chevron">{snapshotsOpen ? '▾' : '▸'}</span>
            </button>
            {snapshotsOpen && (
              <div className="gk-snapshot-list">
                {snapshots.length === 0 ? (
                  <div className="gk-empty-state small">No snapshots yet.</div>
                ) : snapshots.map(s => (
                  <SnapshotRow key={s.tag} snapshot={s} onRestore={handleRestore} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Diff + History */}
        <div className="gk-right">
          <div className="gk-tabs">
            <button className={`gk-tab${rightPanel === 'diff' ? ' active' : ''}`} onClick={() => setRightPanel('diff')}>
              Diff
            </button>
            <button className={`gk-tab${rightPanel === 'history' ? ' active' : ''}`} onClick={() => setRightPanel('history')}>
              History
              {log.length > 0 && <span className="gk-tab-badge">{log.length}</span>}
            </button>
          </div>
          <div className="gk-right-body">
            {rightPanel === 'diff'
              ? <DiffViewer diff={diff} filePath={selectedDiff} />
              : <CommitHistory log={log} />
            }
          </div>
        </div>

      </div>
    </div>
  );
}
