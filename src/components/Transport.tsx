import { useState, useEffect, useRef } from 'react';
import type { Session } from '../Session.js';
import type { SessionState } from '../types.js';
import { linearToDb, dbToLinear, formatDb } from '../waveform.js';

interface Props {
  session: Session;
  state: SessionState;
  isPlaying: boolean;
  playhead: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (pos: number) => void;
}

export function Transport({ session, state, isPlaying, playhead, onPlay, onPause }: Props) {
  const seconds = Math.floor(playhead / 44100);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  const [localDb, setLocalDb] = useState(() => linearToDb(state.masterGain));
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setLocalDb(linearToDb(state.masterGain));
  }, [state.masterGain]);

  return (
    <div className="transport">
      <button className="btn-transport-play" onClick={isPlaying ? onPause : onPlay}>
        {isPlaying ? '⏸' : '▶'}
      </button>

      <span className="time">{mm}:{ss}</span>

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
        onMouseDown={() => { dragging.current = true; }}
        onChange={e => {
          const db = parseFloat(e.target.value);
          setLocalDb(db);
          session.getEngine().setMasterGain(dbToLinear(db));
        }}
        onMouseUp={e => {
          dragging.current = false;
          const db = parseFloat((e.target as HTMLInputElement).value);
          session.execute(session.makeSetMasterGain(dbToLinear(db)));
        }}
      />
      <span className="transport-label">{formatDb(localDb)}</span>
    </div>
  );
}
