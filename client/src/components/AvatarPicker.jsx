import { useState } from 'react';
import './AvatarPicker.css';

const EMOJIS = ['🚀','💡','🔥','⚡','🎯','🛠️','🌊','🦋','🌙','⭐','💎','🎮','🧩','🔮','🐉','🌿','🎨','🤖'];
const COLORS = ['#6366f1','#8b5cf6','#ec4899','#ef4444','#f59e0b','#22c55e','#06b6d4','#3b82f6','#64748b','#92400e'];

export default function AvatarPicker({ project, onSave, onClose }) {
  const [selected, setSelected] = useState(project.avatar || '');

  function preview() {
    const isEmoji = selected && !selected.startsWith('#');
    const color = isEmoji ? '#6366f1' : (selected || '#6366f1');
    return (
      <div className="avatar-preview" style={{ background: color }}>
        {isEmoji ? selected : project.name.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal avatar-modal" role="dialog" aria-modal="true" aria-labelledby="ap-title">
        <div className="modal-header">
          <h2 id="ap-title" className="modal-title">Project avatar</h2>
        </div>
        <div className="modal-body">
          <div className="avatar-picker-preview">
            {preview()}
            <span className="avatar-preview-label">{project.name}</span>
          </div>

          <div className="avatar-section-title">Emoji</div>
          <div className="avatar-emoji-grid">
            {EMOJIS.map(e => (
              <button
                key={e}
                className={`avatar-emoji-btn${selected === e ? ' selected' : ''}`}
                onClick={() => setSelected(e)}
              >
                {e}
              </button>
            ))}
          </div>

          <div className="avatar-section-title">Color</div>
          <div className="avatar-color-grid">
            {COLORS.map(c => (
              <button
                key={c}
                className={`avatar-color-btn${selected === c ? ' selected' : ''}`}
                style={{ background: c }}
                onClick={() => setSelected(c)}
                aria-label={c}
              />
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(selected)}>Save</button>
        </div>
      </div>
    </div>
  );
}
