import { useRef, useState, useEffect } from 'react';
import type { Session } from '../Session.js';
import type { SessionState } from '../types.js';
import { TrackStrip } from './TrackStrip.js';

interface Props {
  session: Session;
  state: SessionState;
}

export function Mixer({ session, state }: Props) {
  const [localMaster, setLocalMaster] = useState(state.masterGain);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current) setLocalMaster(state.masterGain);
  }, [state.masterGain]);

  return (
    <div className="mixer">
      {[...state.tracks.values()].map(track => (
        <TrackStrip key={track.stableId} session={session} track={track} />
      ))}

      <div className="master-strip">
        <div className="track-name">MASTER</div>
        <div className="param-row">
          <label>Vol</label>
          <input
            type="range" min={0} max={1.5} step={0.01}
            value={localMaster}
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
          <span>{Math.round(localMaster * 100)}%</span>
        </div>
      </div>
    </div>
  );
}
