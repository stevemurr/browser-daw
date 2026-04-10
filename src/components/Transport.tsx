import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '../Session.js';
import type { SessionState } from '../types.js';
import { linearToDb, dbToLinear, formatDb } from '../waveform.js';
import { SessionSelector } from './SessionSelector.js';
import type { SessionListItem } from '../store/SessionStore.js';
import { BarRulerAdapter, type Subdivision } from './RulerAdapter.js';

interface Props {
  session: Session;
  state: SessionState;
  isPlaying: boolean;
  playhead: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (pos: number) => void;
  // BPM
  bpm: number;
  onBpmChange: (bpm: number) => void;
  onBpmCommit: (bpm: number) => void;
  // Subdivision
  subdivision: Subdivision;
  onSubdivisionChange: (s: Subdivision) => void;
  // Session management
  sessionId: string | null;
  sessionName: string;
  sessions: SessionListItem[];
  onSwitchSession: (id: string) => void;
  onCreateSession: () => void;
  onRenameSession: (id: string, name: string) => void;
  onDeleteSession: (id: string) => void;
}

export function Transport({
  session, state, isPlaying, playhead,
  onPlay, onPause,
  bpm, onBpmChange, onBpmCommit,
  subdivision, onSubdivisionChange,
  sessionId, sessionName, sessions,
  onSwitchSession, onCreateSession, onRenameSession, onDeleteSession,
}: Props) {
  // ── BPM picker ──────────────────────────────────────────────────────────────
  const [localBpm, setLocalBpm] = useState(bpm);
  const [bpmEditing, setBpmEditing] = useState(false);
  const bpmCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bpmDragging = useRef(false);

  // Sync local BPM when external state changes (e.g., undo/redo)
  useEffect(() => {
    if (!bpmDragging.current) setLocalBpm(bpm);
  }, [bpm]);

  const commitBpm = useCallback((value: number) => {
    const clamped = Math.max(30, Math.min(300, Math.round(value)));
    setLocalBpm(clamped);
    onBpmCommit(clamped);
    bpmDragging.current = false;
  }, [onBpmCommit]);

  const handleBpmWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    bpmDragging.current = true;
    setLocalBpm(prev => {
      const next = Math.max(30, Math.min(300, prev + (e.deltaY < 0 ? 1 : -1)));
      onBpmChange(next);
      if (bpmCommitTimer.current) clearTimeout(bpmCommitTimer.current);
      bpmCommitTimer.current = setTimeout(() => commitBpm(next), 500);
      return next;
    });
  }, [onBpmChange, commitBpm]);

  const handleBpmInputBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    commitBpm(parseFloat(e.target.value) || localBpm);
    setBpmEditing(false);
  }, [commitBpm, localBpm]);

  const handleBpmInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitBpm(parseFloat((e.target as HTMLInputElement).value) || localBpm);
      setBpmEditing(false);
    } else if (e.key === 'Escape') {
      setBpmEditing(false);
    }
  }, [commitBpm, localBpm]);

  // ── Position display ────────────────────────────────────────────────────────
  const seconds = Math.floor(playhead / 44100);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const barAdapter = new BarRulerAdapter(localBpm, subdivision, 44100);
  const barPosition = barAdapter.frameToLabel(playhead);

  // ── Master gain ─────────────────────────────────────────────────────────────
  const [localDb, setLocalDb] = useState(() => linearToDb(state.masterGain));
  const gainDragging = useRef(false);
  useEffect(() => {
    if (!gainDragging.current) setLocalDb(linearToDb(state.masterGain));
  }, [state.masterGain]);

  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      await session.exportMix();
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="transport">
      <SessionSelector
        currentSessionId={sessionId}
        currentName={sessionName}
        sessions={sessions}
        onSwitch={onSwitchSession}
        onCreate={onCreateSession}
        onRename={onRenameSession}
        onDelete={onDeleteSession}
      />

      <span className="transport-sep">|</span>

      <button className="btn-transport-play" onClick={isPlaying ? onPause : onPlay}>
        <span className="transport-play-icon">
          <span style={{ visibility: isPlaying ? 'hidden' : 'visible' }}>▶</span>
          <span style={{ visibility: isPlaying ? 'visible' : 'hidden' }}>⏸</span>
        </span>
      </button>

      <span className="time">
        <span className="time-clock">{mm}:{ss}</span>
        <span className="time-sep">|</span>
        <span className="time-bar">{barPosition}</span>
      </span>

      <span className="transport-sep">|</span>

      {/* BPM picker */}
      <div
        className="bpm-picker"
        onWheel={handleBpmWheel}
        title="Scroll to change BPM"
      >
        {bpmEditing ? (
          <input
            className="bpm-input"
            type="number"
            min={30}
            max={300}
            defaultValue={localBpm}
            autoFocus
            onBlur={handleBpmInputBlur}
            onKeyDown={handleBpmInputKeyDown}
          />
        ) : (
          <span
            className="bpm-display"
            onClick={() => setBpmEditing(true)}
          >
            {localBpm} BPM
          </span>
        )}
      </div>

      {/* Subdivision dropdown */}
      <select
        className="subdivision-select"
        value={subdivision}
        onChange={e => onSubdivisionChange(e.target.value as Subdivision)}
        title="Ruler subdivision"
      >
        <option value="1/4">1/4</option>
        <option value="1/8">1/8</option>
        <option value="1/16">1/16</option>
      </select>

      <span className="transport-sep">|</span>

      <button
        disabled={!state.canUndo}
        title={state.undoLabel ?? undefined}
        onClick={() => session.undo()}
      >
        ↩ Undo
      </button>
      <button
        disabled={!state.canRedo}
        title={state.redoLabel ?? undefined}
        onClick={() => session.redo()}
      >
        ↪ Redo
      </button>

      <span className="transport-sep">|</span>

      <label className="transport-label">Master</label>
      <input
        type="range" min={-60} max={6} step={0.1}
        value={localDb}
        className="transport-master-slider"
        onMouseDown={() => { gainDragging.current = true; }}
        onChange={e => {
          const db = parseFloat(e.target.value);
          setLocalDb(db);
          session.getEngine().setMasterGain(dbToLinear(db));
        }}
        onMouseUp={e => {
          gainDragging.current = false;
          const db = parseFloat((e.target as HTMLInputElement).value);
          session.execute(session.makeSetMasterGain(dbToLinear(db)));
        }}
      />
      <span className="transport-label">{formatDb(localDb)}</span>

      <button
        className="btn-export"
        disabled={exporting}
        onClick={handleExport}
        style={{ marginLeft: 'auto' }}
      >
        {exporting ? 'Exporting…' : 'Export'}
      </button>
    </div>
  );
}
