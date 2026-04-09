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
        ↩ {state.undoLabel ?? 'Undo'}
      </button>
      <button
        disabled={!state.canRedo}
        title={state.redoLabel ?? undefined}
        onClick={() => session.redo()}
      >
        ↪ {state.redoLabel ?? 'Redo'}
      </button>
    </div>
  );
}
