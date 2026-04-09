import { useState, useEffect, useRef } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { EQPanel } from './EQPanel.js';

interface Props {
  session: Session;
  track: TrackMirror;
}

export function TrackStrip({ session, track }: Props) {
  const [showEQ, setShowEQ] = useState(false);

  const [localGain, setLocalGain] = useState(track.gain);
  const [localPan, setLocalPan] = useState(track.pan);
  const gainDragging = useRef(false);
  const panDragging = useRef(false);

  useEffect(() => {
    if (!gainDragging.current) setLocalGain(track.gain);
  }, [track.gain]);

  useEffect(() => {
    if (!panDragging.current) setLocalPan(track.pan);
  }, [track.pan]);

  const panLabel = localPan === 0 ? 'C'
    : localPan > 0 ? `R${Math.round(localPan * 100)}`
    : `L${Math.round(-localPan * 100)}`;

  return (
    <div className={`track-strip${track.muted ? ' muted' : ''}${track.soloed ? ' soloed' : ''}`}>
      <div className="track-name" title={track.name}>
        {track.name.replace(/\.[^.]+$/, '').slice(0, 18)}
      </div>

      {/* Volume */}
      <div className="param-row">
        <label>Vol</label>
        <input
          type="range" min={0} max={2} step={0.01}
          value={localGain}
          onMouseDown={() => { gainDragging.current = true; }}
          onChange={e => {
            const v = parseFloat(e.target.value);
            setLocalGain(v);
            session.getEngine().setGain(track.engineSlot, v);
          }}
          onMouseUp={e => {
            gainDragging.current = false;
            const v = parseFloat((e.target as HTMLInputElement).value);
            session.execute(session.makeSetGain(track.stableId, v));
          }}
        />
        <span>{Math.round(localGain * 100)}%</span>
      </div>

      {/* Pan */}
      <div className="param-row">
        <label>Pan</label>
        <input
          type="range" min={-1} max={1} step={0.01}
          value={localPan}
          onMouseDown={() => { panDragging.current = true; }}
          onChange={e => {
            const v = parseFloat(e.target.value);
            setLocalPan(v);
            session.getEngine().setPan(track.engineSlot, v);
          }}
          onMouseUp={e => {
            panDragging.current = false;
            const v = parseFloat((e.target as HTMLInputElement).value);
            session.execute(session.makeSetPan(track.stableId, v));
          }}
        />
        <span>{panLabel}</span>
      </div>

      {/* Mute / Solo / EQ */}
      <div className="btn-row">
        <button
          className={`btn-mute${track.muted ? ' active' : ''}`}
          onClick={() => session.execute(session.makeSetMute(track.stableId, !track.muted))}
        >M</button>
        <button
          className={`btn-solo${track.soloed ? ' active' : ''}`}
          onClick={() => session.execute(session.makeSetSolo(track.stableId, !track.soloed))}
        >S</button>
        <button
          className={`btn-eq${showEQ ? ' active' : ''}`}
          onClick={() => setShowEQ(v => !v)}
        >EQ</button>
      </div>

      {showEQ && <EQPanel session={session} track={track} />}
    </div>
  );
}
