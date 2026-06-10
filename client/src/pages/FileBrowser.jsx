import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import './FileBrowser.css';

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function formatDate(ms) {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
}

function ConfirmDelete({ folder, onCancel, onConfirm, busy }) {
  return (
    <div className="fb-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="fb-modal" role="dialog" aria-modal="true">
        <h3 className="fb-modal-title">Delete folder</h3>
        <p className="fb-modal-text">
          Permanently delete <code>/projects/{folder.name}</code> and everything inside it?
          {folder.files > 0 && <> This removes <strong>{folder.files}</strong> file{folder.files === 1 ? '' : 's'} ({formatSize(folder.size)}).</>}
        </p>
        <p className="fb-modal-warning">This cannot be undone.</p>
        <div className="fb-modal-footer">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete folder'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FileBrowser() {
  const { csrfToken } = useAuth();
  const { addToast } = useToast();

  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // folder pending deletion
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/folders');
      const data = await res.json();
      if (data.folders) setFolders(data.folders);
      else setError(data.error || 'Could not load folders.');
    } catch {
      setError('Could not load folders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    if (!confirm) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(confirm.name)}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      const data = await res.json();
      if (data.success) {
        addToast(`Deleted “${confirm.name}”.`);
        setFolders(prev => prev.filter(f => f.name !== confirm.name));
        setConfirm(null);
      } else {
        addToast(data.error || 'Delete failed.', 'error');
      }
    } catch {
      addToast('Delete failed.', 'error');
    } finally {
      setDeleting(false);
    }
  }

  const orphanCount = folders.filter(f => !f.linked).length;

  return (
    <div className="fb-page">
      <div className="fb-header">
        <h1 className="fb-title">FILE BROWSER</h1>
        <button className="btn btn-ghost" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="fb-content">
        <p className="fb-intro">
          All folders under <code>/projects</code>. Folders left behind by old or removed
          projects can be deleted here to reclaim space. Folders still attached to a project
          are protected — delete the project first.
        </p>

        {error && <p className="error-message">{error}</p>}

        {loading && folders.length === 0 ? (
          <p className="fb-empty">Loading…</p>
        ) : folders.length === 0 ? (
          <p className="fb-empty">No folders in /projects.</p>
        ) : (
          <>
            <div className="fb-summary">
              {folders.length} folder{folders.length === 1 ? '' : 's'} · {orphanCount} unused
            </div>
            <div className="fb-list">
              {folders.map(folder => (
                <div key={folder.name} className={`fb-row${folder.linked ? ' linked' : ''}`}>
                  <div className="fb-row-icon" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    </svg>
                  </div>
                  <div className="fb-row-main">
                    <div className="fb-row-name">
                      {folder.name}
                      {folder.linked
                        ? <span className="fb-badge fb-badge-linked" title={`In use by project: ${folder.projectName}`}>In use</span>
                        : <span className="fb-badge fb-badge-orphan">Unused</span>}
                    </div>
                    <div className="fb-row-meta">
                      {formatSize(folder.size)} · {folder.files} file{folder.files === 1 ? '' : 's'} · modified {formatDate(folder.modified)}
                      {folder.linked && <> · project “{folder.projectName}”</>}
                    </div>
                  </div>
                  <button
                    className="btn btn-danger fb-delete-btn"
                    onClick={() => setConfirm(folder)}
                    disabled={folder.linked}
                    title={folder.linked ? 'Delete the project before removing this folder' : 'Delete folder'}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {confirm && (
        <ConfirmDelete
          folder={confirm}
          busy={deleting}
          onCancel={() => setConfirm(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
