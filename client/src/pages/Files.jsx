import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { getSocket } from '../lib/socket';
import SyntaxHighlightedEditor from '../components/SyntaxHighlightedEditor';
import './Files.css';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const TEXT_EXTS = new Set(['.js','.ts','.jsx','.tsx','.mjs','.cjs','.py','.go','.rs','.rb','.php','.java','.c','.cpp','.h','.css','.html','.json','.yaml','.yml','.md','.txt','.sh','.bash','.ps1','.sql','.env','.toml','.ini','.cfg','.xml','.gitignore','.editorconfig']);

function FileIcon({ name, isDir }) {
  if (isDir) return <span className="file-icon dir-icon">📁</span>;
  const ext = name.split('.').pop()?.toLowerCase();
  const icons = { js: '⬡', ts: '🔷', jsx: '⚛', tsx: '⚛', py: '🐍', go: '🔵', rs: '🦀', json: '{}', md: '📝', css: '🎨', html: '🌐', sh: '⬛', sql: '🗄', yaml: '📋', yml: '📋' };
  return <span className="file-icon">{icons[ext] || '📄'}</span>;
}

function FileTreeNode({
  node, depth, onSelect, selectedPath, addToast, gitStatusMap,
  onContextMenu, renamingPath, onStartRename, onRenameSubmit, onRenameCancel,
  expandedPaths, onToggleFolder,
}) {
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const doneRef = useRef(false); // prevents double-submit from Enter→blur or Escape→blur

  const isDir = node.type === 'dir';
  const expanded = isDir && expandedPaths.has(node.path);
  const isRenaming = renamingPath === node.path;
  const active = selectedPath === node.path;

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(node.name);
      doneRef.current = false;
      requestAnimationFrame(() => {
        renameInputRef.current?.select();
      });
    }
  }, [isRenaming, node.name]);

  function handleClick(e) {
    e.stopPropagation();
    if (isRenaming) return;
    if (isDir) onToggleFolder(node.path);
    else onSelect(node);
  }

  function handleContextMenuEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(node, e.clientX, e.clientY);
  }

  function handleRowKeyDown(e) {
    if (e.key === 'F2') {
      e.preventDefault();
      onStartRename(node);
    }
  }

  function handleRenameKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!doneRef.current) {
        doneRef.current = true;
        onRenameSubmit(node, renameValue);
      }
    } else if (e.key === 'Escape') {
      if (!doneRef.current) {
        doneRef.current = true;
        onRenameCancel();
      }
    }
  }

  function handleRenameBlur() {
    if (!doneRef.current) {
      doneRef.current = true;
      onRenameSubmit(node, renameValue);
    }
  }

  const gitStatus = !isDir ? gitStatusMap?.[node.path] : null;
  const dirHasChanges = isDir && gitStatusMap && Object.keys(gitStatusMap).some(p => p.startsWith(node.path + '/'));
  const statusClass = gitStatus === 'M' ? 'git-M' : gitStatus === 'A' ? 'git-A' : gitStatus === 'D' ? 'git-D' : gitStatus === 'R' ? 'git-R' : gitStatus === '??' || gitStatus === '?' ? 'git-U' : null;

  return (
    <div className="file-tree-node">
      <div
        className={`file-tree-row${active ? ' active' : ''}${statusClass ? ' has-git-status' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        tabIndex={0}
        onClick={handleClick}
        onContextMenu={handleContextMenuEvent}
        onKeyDown={handleRowKeyDown}
      >
        {isDir && (
          <span
            className={`tree-chevron${expanded ? ' expanded' : ''}`}
            onClick={e => {
              e.stopPropagation();
              onToggleFolder(node.path);
            }}
          >▶</span>
        )}
        <FileIcon name={node.name} isDir={isDir} />
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="file-tree-rename-input"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameBlur}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className={`file-tree-name${statusClass ? ' ' + statusClass : ''}`}>{node.name}</span>
        )}
        {!isRenaming && statusClass && <span className={`file-git-dot ${statusClass}`} title={gitStatus} />}
        {!isRenaming && dirHasChanges && !statusClass && <span className="file-git-dot dir-changed" title="Contains changes" />}
      </div>

      {isDir && expanded && node.children && (
        <div className="file-tree-children">
          {node.children.map(child => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedPath={selectedPath}
              addToast={addToast}
              gitStatusMap={gitStatusMap}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              onStartRename={onStartRename}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              expandedPaths={expandedPaths}
              onToggleFolder={onToggleFolder}
            />
          ))}
          {node.children.length === 0 && (
            <div className="file-tree-empty-dir" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
              Empty folder
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SimpleEditor({ file, projectId, csrfToken, addToast, onClose }) {
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [previewMode, setPreviewMode] = useState('edit');
  const contentRef = useRef('');
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

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  async function save(contentOverride = content) {
    try {
      const res = await fetch(`/api/projects/${projectId}/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ filePath: file.path, content: contentOverride }),
      });
      const data = await res.json();
      if (data.success) setSaved(contentRef.current === contentOverride);
      else addToast(data.error || 'File save failed.', 'error');
    } catch {
      addToast('File save failed. Check that the file path is still valid.', 'error');
    }
  }

  useEffect(() => {
    if (loading || saved || isImage) return;
    const timer = setTimeout(() => {
      save(content);
    }, 800);
    return () => clearTimeout(timer);
  }, [content, saved, loading, isImage]);

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
          <SyntaxHighlightedEditor
            fileName={file.name}
            textareaClassName="editor-textarea"
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
  const [gitStatusMap, setGitStatusMap] = useState({});
  const [contextMenu, setContextMenu] = useState(null); // { node, x, y }
  const [renamingPath, setRenamingPath] = useState(null);
  const [expandedPaths, setExpandedPaths] = useState(() => new Set());

  useEffect(() => { loadTree(); loadGitStatus(); }, [projectId]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`opus:files-page-expanded:${projectId}`) || '[]');
      setExpandedPaths(new Set(Array.isArray(saved) ? saved : []));
    } catch {
      setExpandedPaths(new Set());
    }
  }, [projectId]);

  useEffect(() => {
    const interval = setInterval(() => { loadTree(); loadGitStatus(); }, 750);
    return () => clearInterval(interval);
  }, [projectId]);

  // Close context menu on any click/right-click outside a tree node
  useEffect(() => {
    if (!contextMenu) return;
    function close() { setContextMenu(null); }
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
    };
  }, [!!contextMenu]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadGitStatus() {
    try {
      const res = await fetch(`/api/projects/${projectId}/git/status`);
      const data = await res.json();
      if (!data.initialized || !data.files) { setGitStatusMap({}); return; }
      const map = {};
      for (const f of data.files) { map[f.path] = (f.status || '?').trim(); }
      setGitStatusMap(map);
    } catch (_) { setGitStatusMap({}); }
  }

  async function loadTree() {
    try {
      const res = await fetch(`/api/projects/${projectId}/files`);
      const data = await res.json();
      setTree(data.tree || []);
    } catch (_) {}
    finally { setLoading(false); }
  }

  function workspacePath(node) {
    const suffix = node?.path ? `/${node.path}` : '';
    return `/workspace${suffix}`;
  }

  function quoteForTerminal(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  function toggleFolder(path) {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      localStorage.setItem(`opus:files-page-expanded:${projectId}`, JSON.stringify([...next]));
      return next;
    });
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

  function handleNodeContextMenu(node, x, y) {
    setContextMenu({ node, x, y });
  }

  function handleStartRename(node) {
    setRenamingPath(node.path);
    setContextMenu(null);
  }

  async function handleRenameSubmit(node, newName) {
    setRenamingPath(null);
    if (!newName || newName === node.name) return;
    const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    await fetch(`/api/projects/${projectId}/files/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ oldPath: node.path, newPath }),
    });
    loadTree();
  }

  async function handleContextAction(action) {
    const node = contextMenu?.node;
    setContextMenu(null);
    if (!node) return;

    if (action === 'copy-path') {
      try {
        await navigator.clipboard.writeText(workspacePath(node));
        addToast('Path copied to clipboard.');
      } catch {
        addToast('Could not copy to clipboard.', 'error');
      }
    } else if (action === 'reference') {
      try {
        const res = await fetch(`/api/projects/${projectId}/terminals`);
        const data = await res.json();
        const sessions = data.sessions || [];
        if (sessions.length === 0) {
          addToast('No terminal sessions open — open a terminal first.', 'error');
          return;
        }
        getSocket().emit('terminal:input', { sessionId: sessions[0].id, data: quoteForTerminal(workspacePath(node)) });
      } catch {
        addToast('Could not send path to terminal.', 'error');
      }
    } else if (action === 'new-file') {
      const name = prompt('File name:');
      if (!name) return;
      await fetch(`/api/projects/${projectId}/files/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ filePath: `${node.path}/${name}`, type: 'file' }),
      });
      loadTree();
    } else if (action === 'new-folder') {
      const name = prompt('Folder name:');
      if (!name) return;
      await fetch(`/api/projects/${projectId}/files/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ filePath: `${node.path}/${name}`, type: 'dir' }),
      });
      loadTree();
    } else if (action === 'rename') {
      setRenamingPath(node.path);
    } else if (action === 'delete') {
      if (!confirm(`Delete "${node.name}"?`)) return;
      await fetch(`/api/projects/${projectId}/files`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ path: node.path }),
      });
      loadTree();
    } else if (action === 'download') {
      window.open(`/api/projects/${projectId}/files/download?path=${encodeURIComponent(node.path)}`);
    }
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
                onSelect={setSelectedFile}
                selectedPath={selectedFile?.path}
                addToast={addToast}
                gitStatusMap={gitStatusMap}
                onContextMenu={handleNodeContextMenu}
                renamingPath={renamingPath}
                onStartRename={handleStartRename}
                onRenameSubmit={handleRenameSubmit}
                onRenameCancel={() => setRenamingPath(null)}
                expandedPaths={expandedPaths}
                onToggleFolder={toggleFolder}
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

      {/* Global context menu — only one at a time */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
          onClick={e => e.stopPropagation()}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
        >
          {contextMenu.node.type === 'dir' && <button role="menuitem" onClick={() => handleContextAction('new-file')}>New File</button>}
          {contextMenu.node.type === 'dir' && <button role="menuitem" onClick={() => handleContextAction('new-folder')}>New Folder</button>}
          <button role="menuitem" onClick={() => handleContextAction('rename')}>Rename</button>
          <button role="menuitem" onClick={() => handleContextAction('reference')}>Reference</button>
          <button role="menuitem" onClick={() => handleContextAction('copy-path')}>Copy Path</button>
          {contextMenu.node.type !== 'dir' && <button role="menuitem" onClick={() => handleContextAction('download')}>Download</button>}
          <div className="context-separator" />
          <button role="menuitem" className="context-danger" onClick={() => handleContextAction('delete')}>Delete</button>
        </div>
      )}
    </div>
  );
}
