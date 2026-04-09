import { useState, useEffect, useRef } from 'react';
import type { Session } from '../Session.js';
import type { SessionState } from '../types.js';

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

  const [localMaster, setLocalMaster] = useState(state.masterGain);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setLocalMaster(state.masterGain);
  }, [state.masterGain]);

  return (
    <div className="transport">
      <button onClick={isPlaying ? onPause : onPlay}>
        {isPlaying ? '⏸ Pause' : '▶ Play'}
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
        type="range" min={0} max={1.5} step={0.01}
        value={localMaster}
        className="transport-master-slider"
        onMouseDown={() => { dragging.current = true; }}
        onChange={e => {
          const v = parseFloat(e.target.value);
          setLocalMaster(v);
          session.getEngine().setMasterGain(v);
        }}
        onMouseUp={e => {
          dragging.current = false;
          const v = parseFloat((e.target as HTMLInputElement).value);
          session.execute(session.makeSetMasterGain(v));
        }}
      />
      <span className="transport-label">{Math.round(localMaster * 100)}%</span>
    </div>
  );
}
