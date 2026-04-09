import { useState, useEffect, useRef } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';

interface TrackHeaderProps {
  session: Session;
  track: TrackMirror;
  height: number;
}

/**
 * Compact track header rendered to the left of each track lane.
 * Contains: name, volume slider, pan slider, mute and solo buttons.
 * EQ is intentionally omitted here.
 */
export function TrackHeader({ session, track, height }: TrackHeaderProps) {
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
    <div
      className={`track-header${track.muted ? ' muted' : ''}${track.soloed ? ' soloed' : ''}`}
      style={{ height }}
    >
      <div className="track-header-name" title={track.name}>
        {track.name.replace(/\.[^.]+$/, '').slice(0, 16)}
      </div>

      <div className="track-header-controls">
        {/* Volume */}
        <div className="th-param-row">
          <label>Vol</label>
          <input
            type="range" min={0} max={2} step={0.01}
            value={localGain}
            onMouseDown={() => { gainDragging.current = true; }}
            onChange={e => {
              const v = parseFloat(e.target.value);
              setLocalGain(v);
              for (const r of session.regionsForTrack(track.stableId)) {
                session.getEngine().setGain(r.engineSlot, v);
              }
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
        <div className="th-param-row">
          <label>Pan</label>
          <input
            type="range" min={-1} max={1} step={0.01}
            value={localPan}
            onMouseDown={() => { panDragging.current = true; }}
            onChange={e => {
              const v = parseFloat(e.target.value);
              setLocalPan(v);
              for (const r of session.regionsForTrack(track.stableId)) {
                session.getEngine().setPan(r.engineSlot, v);
              }
            }}
            onMouseUp={e => {
              panDragging.current = false;
              const v = parseFloat((e.target as HTMLInputElement).value);
              session.execute(session.makeSetPan(track.stableId, v));
            }}
          />
          <span>{panLabel}</span>
        </div>

        {/* Mute / Solo */}
        <div className="th-btn-row">
          <button
            className={`btn-mute${track.muted ? ' active' : ''}`}
            onClick={() => session.execute(session.makeSetMute(track.stableId, !track.muted))}
          >M</button>
          <button
            className={`btn-solo${track.soloed ? ' active' : ''}`}
            onClick={() => session.execute(session.makeSetSolo(track.stableId, !track.soloed))}
          >S</button>
        </div>
      </div>
    </div>
  );
}
