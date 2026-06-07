import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import './Files.css';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const TEXT_EXTS = new Set(['.js','.ts','.jsx','.tsx','.mjs','.cjs','.py','.go','.rs','.rb','.php','.java','.c','.cpp','.h','.css','.html','.json','.yaml','.yml','.md','.txt','.sh','.bash','.ps1','.sql','.env','.toml','.ini','.cfg','.xml','.gitignore','.editorconfig']);

function FileIcon({ name, isDir }) {
  if (isDir) return <span className="file-icon dir-icon">📁</span>;
  const ext = name.split('.').pop()?.toLowerCase();
  const icons = { js: '⬡', ts: '🔷', jsx: '⚛', tsx: '⚛', py: '🐍', go: '🔵', rs: '🦀', json: '{}', md: '📝', css: '🎨', html: '🌐', sh: '⬛', sql: '🗄', yaml: '📋', yml: '📋' };
  return <span className="file-icon">{icons[ext] || '📄'}</span>;
}

function FileTreeNode({ node, depth, projectId, csrfToken, onSelect, selectedPath, onRefresh, addToast }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [children, setChildren] = useState(node.children || []);
  const [contextMenu, setContextMenu] = useState(null);
  const [childrenLoaded, setChildrenLoaded] = useState(false);

  const isDir = node.type === 'dir';

  async function loadChildren() {
    if (!isDir || childrenLoaded) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/files?path=${encodeURIComponent(node.path)}`);
      // The tree API returns the full tree from root; we traverse it
      setChildrenLoaded(true);
    } catch (_) {}
  }

  function handleClick(e) {
    e.stopPropagation();
    if (isDir) {
      setExpanded(e => !e);
    } else {
      onSelect(node);
    }
  }

  function handleContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  async function handleContextAction(action) {
    setContextMenu(null);
    if (action === 'copy-path') {
      try {
        await navigator.clipboard.writeText(`/projects/${node.path}`);
        addToast('Path copied to clipboard.');
      } catch {
        addToast('Could not copy to clipboard.', 'error');
      }
    } else if (action === 'new-file') {
      const name = prompt('File name:');
      if (!name) return;
      const newPath = `${node.path}/${name}`;
      await fetch(`/api/projects/${projectId}/files/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ filePath: newPath, type: 'file' }),
      });
      onRefresh();
    } else if (action === 'new-folder') {
      const name = prompt('Folder name:');
      if (!name) return;
      const newPath = `${node.path}/${name}`;
      await fetch(`/api/projects/${projectId}/files/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ filePath: newPath, type: 'dir' }),
      });
      onRefresh();
    } else if (action === 'rename') {
      const name = prompt('New name:', node.name);
      if (!name || name === node.name) return;
      const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
      const newPath = parentPath ? `${parentPath}/${name}` : name;
      await fetch(`/api/projects/${projectId}/files/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ oldPath: node.path, newPath }),
      });
      onRefresh();
    } else if (action === 'delete') {
      if (!confirm(`Delete "${node.name}"?`)) return;
      await fetch(`/api/projects/${projectId}/files`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ path: node.path }),
      });
      onRefresh();
    } else if (action === 'download') {
      window.open(`/api/projects/${projectId}/files/download?path=${encodeURIComponent(node.path)}`);
    }
  }

  const active = selectedPath === node.path;

  return (
    <div className="file-tree-node">
      <div
        className={`file-tree-row${active ? ' active' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {isDir && (
          <span className={`tree-chevron${expanded ? ' expanded' : ''}`}>▶</span>
        )}
        <FileIcon name={node.name} isDir={isDir} />
        <span className="file-tree-name">{node.name}</span>
      </div>

      {isDir && expanded && node.children && (
        <div className="file-tree-children">
          {node.children.map(child => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              projectId={projectId}
              csrfToken={csrfToken}
              onSelect={onSelect}
              selectedPath={selectedPath}
              onRefresh={onRefresh}
              addToast={addToast}
            />
          ))}
          {node.children.length === 0 && (
            <div className="file-tree-empty-dir" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
              Empty folder
            </div>
          )}
        </div>
      )}

      {contextMenu && (
        <>
          <div className="context-backdrop" onClick={() => setContextMenu(null)} />
          <div
            className="context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            role="menu"
          >
            {isDir && <button role="menuitem" onClick={() => handleContextAction('new-file')}>New File</button>}
            {isDir && <button role="menuitem" onClick={() => handleContextAction('new-folder')}>New Folder</button>}
            <button role="menuitem" onClick={() => handleContextAction('rename')}>Rename</button>
            <button role="menuitem" onClick={() => handleContextAction('copy-path')}>Copy Path</button>
            {!isDir && <button role="menuitem" onClick={() => handleContextAction('download')}>Download</button>}
            <div className="context-separator" />
            <button role="menuitem" className="context-danger" onClick={() => handleContextAction('delete')}>Delete</button>
          </div>
        </>
      )}
    </div>
  );
}

function SimpleEditor({ file, projectId, csrfToken, addToast, onClose }) {
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [previewMode, setPreviewMode] = useState('edit');
  const ext = file.name.split('.').pop()?.toLowerCase();
  const isMarkdown = ext === 'md';
  const isJsonYaml = ext === 'json' || ext === 'yaml' || ext === 'yml';
  const isImage = IMAGE_EXTS.has(`.${ext}`);

  useEffect(() => {
    if (isImage) { setLoading(false); return; }
    fetch(`/api/projects/${projectId}/files/read?path=${encodeURIComponent(file.path)}`)
      .then(r => r.json())
      .then(d => { setContent(d.content || ''); setLoading(false); })
      .catch(() => { addToast('Could not load file.', 'error'); setLoading(false); });
  }, [file.path]);

  async function save() {
    try {
      const res = await fetch(`/api/projects/${projectId}/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ filePath: file.path, content }),
      });
      const data = await res.json();
      if (data.success) setSaved(true);
      else addToast(data.error || 'File save failed.', 'error');
    } catch {
      addToast('File save failed. Check that the file path is still valid.', 'error');
    }
  }

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  }

  function format() {
    try {
      if (ext === 'json') {
        setContent(JSON.stringify(JSON.parse(content), null, 2));
        setSaved(false);
      }
    } catch {
      addToast('Invalid JSON — cannot format.', 'error');
    }
  }

  if (loading) return <div className="editor-loading">Loading…</div>;

  if (isImage) {
    return (
      <div className="image-viewer">
        <div className="editor-tab-bar">
          <span className="editor-tab active">{file.name}</span>
          <div className="editor-toolbar-right">
            <button className="btn btn-ghost" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="image-container">
          <img
            src={`/api/projects/${projectId}/files/read?path=${encodeURIComponent(file.path)}`}
            alt={file.name}
            className="image-preview"
          />
        </div>
      </div>
    );
  }

  if (!TEXT_EXTS.has(`.${ext}`) && !isImage) {
    return (
      <div className="editor-unsupported">
        <div className="editor-tab-bar">
          <span className="editor-tab active">{file.name}</span>
          <div className="editor-toolbar-right">
            <button className="btn btn-ghost" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="editor-unsupported-msg">This file cannot be displayed.</div>
      </div>
    );
  }

  return (
    <div className="editor" onKeyDown={handleKeyDown}>
      <div className="editor-tab-bar">
        <span className="editor-tab active">
          {file.name}{!saved ? ' ·' : ''}
        </span>
        <div className="editor-toolbar-right">
          {isMarkdown && (
            <div className="editor-mode-toggle">
              {['edit', 'preview', 'split'].map(m => (
                <button key={m} className={`btn btn-ghost${previewMode === m ? ' active' : ''}`} onClick={() => setPreviewMode(m)}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          )}
          {isJsonYaml && (
            <button className="btn btn-ghost" onClick={format}>Format</button>
          )}
          <button className="btn btn-primary" onClick={save}>Save</button>
          <button className="btn btn-ghost" onClick={() => {
            if (!saved && !confirm('Discard unsaved changes?')) return;
            onClose();
          }}>✕</button>
        </div>
      </div>

      <div className={`editor-content${previewMode === 'split' ? ' split' : ''}`}>
        {(previewMode === 'edit' || previewMode === 'split') && (
          <textarea
            className="editor-textarea"
            value={content}
            onChange={e => { setContent(e.target.value); setSaved(false); }}
            spellCheck={false}
          />
        )}
        {isMarkdown && (previewMode === 'preview' || previewMode === 'split') && (
          <div
            className="editor-preview"
            dangerouslySetInnerHTML={{ __html: simpleMarkdown(content) }}
          />
        )}
      </div>
    </div>
  );
}

// Simple markdown renderer (no external dep)
function simpleMarkdown(md) {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (m, p) => p.startsWith('<') ? p : `<p>${p}</p>`);
}

export default function FilesPage() {
  const { id: projectId } = useParams();
  const { csrfToken } = useAuth();
  const { addToast } = useToast();

  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => { loadTree(); }, [projectId]);

  // Refresh tree every 2s for AI-agent changes
  useEffect(() => {
    const interval = setInterval(loadTree, 2000);
    return () => clearInterval(interval);
  }, [projectId]);

  async function loadTree() {
    try {
      const res = await fetch(`/api/projects/${projectId}/files`);
      const data = await res.json();
      setTree(data.tree || []);
    } catch (_) {}
    finally { setLoading(false); }
  }

  async function handleSearch(q) {
    setSearchQuery(q);
    if (!q) { setSearchResults(null); return; }
    const res = await fetch(`/api/projects/${projectId}/files/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setSearchResults(data.results || []);
  }

  async function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;

    const form = new FormData();
    files.forEach(f => form.append('files', f));

    try {
      const res = await fetch(`/api/projects/${projectId}/files/upload`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        body: form,
      });
      const data = await res.json();
      data.uploaded?.forEach(f => addToast(`${f.name} uploaded.`));
      loadTree();
    } catch (err) {
      addToast(`Upload failed: ${err.message}`, 'error');
    }
  }

  async function createNew(type) {
    const name = prompt(type === 'dir' ? 'Folder name:' : 'File name:');
    if (!name || !name.trim()) return;
    const res = await fetch(`/api/projects/${projectId}/files/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ filePath: name.trim(), type }),
    });
    const data = await res.json();
    if (data.success) { addToast(`${type === 'dir' ? 'Folder' : 'File'} created.`); loadTree(); }
    else addToast(data.error || 'Create failed.', 'error');
  }

  return (
    <div className="files-page">
      {/* File tree panel */}
      <div
        className={`file-tree-panel${dragOver ? ' drag-over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {dragOver && <div className="drop-overlay">Drop files to upload</div>}

        {/* Toolbar */}
        <div className="file-tree-toolbar">
          <span className="file-tree-toolbar-title">FILES</span>
          <button className="btn btn-ghost file-tree-btn" onClick={() => createNew('file')} title="New file">+ File</button>
          <button className="btn btn-ghost file-tree-btn" onClick={() => createNew('dir')}  title="New folder">+ Folder</button>
        </div>

        <div className="file-tree-search">
          <input
            className="input"
            placeholder="Search files…"
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>

        {searchQuery ? (
          <div className="file-search-results">
            {searchResults?.length === 0 && (
              <p className="search-empty">No files match '{searchQuery}'</p>
            )}
            {searchResults?.map(r => (
              <div key={r.path} className="search-result" onClick={() => setSelectedFile(r)}>
                {r.name}
                <span className="search-result-path">{r.path}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="file-tree-scroll">
            {loading && <div className="file-tree-loading">Loading…</div>}
            {!loading && tree.length === 0 && (
              <div className="file-tree-empty-state">
                <p>Empty folder</p>
                <button className="btn btn-ghost" style={{fontSize:'var(--font-size-xs)'}} onClick={() => createNew('file')}>+ New file</button>
                <button className="btn btn-ghost" style={{fontSize:'var(--font-size-xs)'}} onClick={() => createNew('dir')}>+ New folder</button>
              </div>
            )}
            {tree.map(node => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={0}
                projectId={projectId}
                csrfToken={csrfToken}
                onSelect={setSelectedFile}
                selectedPath={selectedFile?.path}
                onRefresh={loadTree}
                addToast={addToast}
              />
            ))}
          </div>
        )}
      </div>

      {/* Editor/viewer panel */}
      <div className="editor-panel">
        {selectedFile ? (
          <SimpleEditor
            file={selectedFile}
            projectId={projectId}
            csrfToken={csrfToken}
            addToast={addToast}
            onClose={() => setSelectedFile(null)}
          />
        ) : (
          <div className="editor-empty">
            <p>Select a file to view or edit.</p>
            <p className="editor-hint">Right-click files for options. Drag files to upload.</p>
          </div>
        )}
      </div>
    </div>
  );
}
