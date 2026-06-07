import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import './Git.css';

function StatusBadge({ status }) {
  const labels = { M: 'M', A: 'A', D: 'D', R: 'R', '??': '?', '?': '?' };
  const colors = { M: 'warning', A: 'success', D: 'error', R: 'info', '??': 'dim', '?': 'dim' };
  const s = (status || '?').trim();
  return (
    <span className={`git-status-badge status-${colors[s] || 'dim'}`}>{labels[s] || s}</span>
  );
}

function FileRow({ file, staged, onStage, onRevert, onSelectDiff, selectedDiff, csrfToken }) {
  const [confirmRevert, setConfirmRevert] = useState(false);
  const isSelected = selectedDiff === file.path;

  function handleRevert(e) {
    e.stopPropagation();
    if (confirmRevert) {
      onRevert(file.path);
      setConfirmRevert(false);
    } else {
      setConfirmRevert(true);
      setTimeout(() => setConfirmRevert(false), 3000);
    }
  }

  return (
    <div className={`git-file-row${isSelected ? ' selected' : ''}`} onClick={() => onSelectDiff(file.path)}>
      <input
        type="checkbox"
        checked={staged}
        onChange={e => { e.stopPropagation(); onStage(file.path, !staged); }}
        onClick={e => e.stopPropagation()}
        className="git-file-checkbox"
      />
      <StatusBadge status={file.status} />
      <span className="git-file-name">{file.path}</span>
      <button
        className={`git-revert-btn${confirmRevert ? ' confirming' : ''}`}
        onClick={handleRevert}
        title={confirmRevert ? 'Confirm revert' : 'Revert changes'}
      >
        {confirmRevert ? 'Revert?' : '↩'}
      </button>
    </div>
  );
}

function DiffView({ diff }) {
  if (!diff) return null;
  const lines = diff.split('\n');
  return (
    <div className="diff-view">
      {lines.map((line, i) => {
        let cls = 'diff-line';
        if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-added';
        else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-removed';
        else if (line.startsWith('@@')) cls += ' diff-hunk';
        return <div key={i} className={cls}><code>{line || ' '}</code></div>;
      })}
    </div>
  );
}

function SnapshotRow({ snapshot, onRestore }) {
  const [showConfirm, setShowConfirm] = useState(false);

  function ts(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return `Today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="snapshot-row">
      <div className="snapshot-info">
        <span className="snapshot-tag">{snapshot.tag}</span>
        <span className="snapshot-time">{ts(snapshot.date)}</span>
        {snapshot.label && <span className="snapshot-label">{snapshot.label}</span>}
      </div>
      {showConfirm ? (
        <div className="snapshot-confirm">
          <button className="btn btn-danger" onClick={() => { onRestore(snapshot.tag); setShowConfirm(false); }}>Restore</button>
          <button className="btn btn-ghost" onClick={() => setShowConfirm(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn btn-ghost snapshot-restore" onClick={() => setShowConfirm(true)}>Restore</button>
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
  const [newBranch, setNewBranch] = useState('');
  const [showBranch, setShowBranch] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStatus();
    loadSnapshots();
    const interval = setInterval(loadStatus, 3000);
    return () => clearInterval(interval);
  }, [projectId]);

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

  async function handleStage(filePath, doStage) {
    await fetch(`/api/projects/${projectId}/git/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ files: [filePath], unstage: !doStage }),
    });
    setStaged(prev => {
      const next = new Set(prev);
      if (doStage) next.add(filePath);
      else next.delete(filePath);
      return next;
    });
  }

  async function handleSelectDiff(filePath) {
    setSelectedDiff(filePath);
    try {
      const res = await fetch(`/api/projects/${projectId}/git/diff?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      setDiff(data.diff || '');
    } catch { setDiff(''); }
  }

  async function handleCommit() {
    if (!commitMessage.trim()) {
      addToast('Commit message is required.', 'error');
      return;
    }
    const res = await fetch(`/api/projects/${projectId}/git/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ message: commitMessage }),
    });
    const data = await res.json();
    if (data.success) {
      setCommitMessage('');
      setStaged(new Set());
      addToast('Committed successfully.');
      loadStatus();
    } else {
      addToast(data.error || 'Commit failed.', 'error');
    }
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
    if (data.success) { addToast(`Snapshot created — ${data.tag}`); loadSnapshots(); }
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
    if (data.success) { setNewBranch(''); setShowBranch(false); loadStatus(); addToast(`Switched to branch ${data.branch}.`); }
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

  if (loading) return <div className="git-loading">Loading…</div>;

  if (!status?.initialized) {
    return (
      <div className="git-page">
        <div className="git-uninitialized">
          <p>Git is not initialized in this project folder.</p>
          <p className="git-hint">Run <code>git init</code> in the terminal to get started.</p>
        </div>
      </div>
    );
  }

  const unstagedFiles = (status.files || []).filter(f => !staged.has(f.path));
  const stagedFiles = (status.files || []).filter(f => staged.has(f.path));

  return (
    <div className="git-page">
      <div className="git-panel">
        {/* Branch bar */}
        <div className="git-branch-bar">
          <span className="git-branch-name">⎇ {status.branch}</span>
          <span className="git-changed-count">
            {status.files?.length || 0} changed
          </span>
          <button className="btn btn-ghost" onClick={handleSnapshot}>Create Snapshot</button>
          <button className="btn btn-ghost" onClick={() => setShowBranch(s => !s)}>New Branch</button>
        </div>

        {showBranch && (
          <div className="git-new-branch">
            <input
              className="input"
              placeholder="branch-name"
              value={newBranch}
              onChange={e => setNewBranch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateBranch()}
            />
            <button className="btn btn-primary" onClick={handleCreateBranch}>Create</button>
            <button className="btn btn-ghost" onClick={() => setShowBranch(false)}>Cancel</button>
          </div>
        )}

        {/* Changes section */}
        <div className="git-section">
          <div className="git-section-header">
            <span className="git-section-title">CHANGES</span>
            {(status.files?.length > 0) && (
              <button className="btn btn-ghost git-revert-all" onClick={handleRevertAll}>Revert All</button>
            )}
          </div>

          {status.clean ? (
            <div className="git-clean">Working tree clean.</div>
          ) : (
            <>
              {unstagedFiles.length > 0 && (
                <div className="git-subsection">
                  <div className="git-subsection-title">Unstaged</div>
                  {unstagedFiles.map(f => (
                    <FileRow
                      key={f.path}
                      file={f}
                      staged={false}
                      onStage={handleStage}
                      onRevert={handleRevert}
                      onSelectDiff={handleSelectDiff}
                      selectedDiff={selectedDiff}
                    />
                  ))}
                </div>
              )}

              {stagedFiles.length > 0 && (
                <div className="git-subsection">
                  <div className="git-subsection-title">Staged</div>
                  {stagedFiles.map(f => (
                    <FileRow
                      key={f.path}
                      file={f}
                      staged={true}
                      onStage={handleStage}
                      onRevert={handleRevert}
                      onSelectDiff={handleSelectDiff}
                      selectedDiff={selectedDiff}
                    />
                  ))}
                  <div className="git-commit-area">
                    <textarea
                      className="git-commit-msg"
                      placeholder="Commit message…"
                      value={commitMessage}
                      onChange={e => setCommitMessage(e.target.value)}
                    />
                    <button className="btn btn-primary" onClick={handleCommit}>Commit</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Diff view */}
        {selectedDiff && diff && (
          <div className="git-section">
            <div className="git-section-title">DIFF — {selectedDiff}</div>
            <DiffView diff={diff} />
          </div>
        )}

        {/* Snapshots section */}
        <div className="git-section">
          <div className="git-section-title">SNAPSHOTS</div>
          {snapshots.length === 0 ? (
            <div className="git-clean">No snapshots. Create one before starting an AI session.</div>
          ) : (
            snapshots.map(s => (
              <SnapshotRow key={s.tag} snapshot={s} onRestore={handleRestore} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
