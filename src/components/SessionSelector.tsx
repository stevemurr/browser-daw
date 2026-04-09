import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { SessionListItem } from '../store/SessionStore.js';

interface Props {
  currentSessionId: string | null;
  currentName: string;
  sessions: SessionListItem[];
  onSwitch: (sessionId: string) => void;
  onCreate: () => void;
  onRename: (sessionId: string, name: string) => void;
  onDelete: (sessionId: string) => void;
}

export function SessionSelector({
  currentSessionId,
  currentName,
  sessions,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [open, setOpen]               = useState(false);
  const [renaming, setRenaming]       = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const btnRef      = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const [dropPos, setDropPos] = useState<{ left: number; top: number } | null>(null);

  function openDropdown() {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setDropPos({ left: rect.left, top: rect.bottom + 4 });
    setOpen(true);
  }

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        btnRef.current    && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setRenaming(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Focus & select rename input when it appears
  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  function startRename() {
    setRenameValue(currentName);
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && currentSessionId) onRename(currentSessionId, trimmed);
    setRenaming(false);
  }

  const others = sessions.filter(s => s.sessionId !== currentSessionId);

  return (
    <>
      <button
        ref={btnRef}
        className="session-selector-btn"
        onClick={openDropdown}
        title="Switch session"
      >
        <span className="session-selector-name">{currentName || 'Session'}</span>
        <span className="session-selector-chevron">▾</span>
      </button>

      {open && dropPos && createPortal(
        <div
          ref={dropdownRef}
          className="session-dropdown"
          style={{ left: dropPos.left, top: dropPos.top }}
        >
          {/* Active session row — click name to rename */}
          <div className="session-dropdown-item active">
            {renaming ? (
              <input
                ref={inputRef}
                className="session-rename-input"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                  if (e.key === 'Escape') setRenaming(false);
                }}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span
                className="session-item-name"
                onClick={e => { e.stopPropagation(); startRename(); }}
                title="Click to rename"
              >
                {currentName || 'Session'}
              </span>
            )}
            <button
              className="session-delete-btn"
              disabled={sessions.length <= 1}
              onClick={e => {
                e.stopPropagation();
                if (currentSessionId) { onDelete(currentSessionId); setOpen(false); }
              }}
              title="Delete session"
            >
              ✕
            </button>
          </div>

          {/* Other sessions */}
          {others.map(s => (
            <div
              key={s.sessionId}
              className="session-dropdown-item"
              onClick={() => { onSwitch(s.sessionId); setOpen(false); }}
            >
              <span className="session-item-name">{s.name}</span>
              <button
                className="session-delete-btn"
                onClick={e => { e.stopPropagation(); onDelete(s.sessionId); }}
                title="Delete session"
              >
                ✕
              </button>
            </div>
          ))}

          <div
            className="session-new-btn"
            onClick={() => { onCreate(); setOpen(false); }}
          >
            + New Session
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
