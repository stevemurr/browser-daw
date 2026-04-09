import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { linearToDb, dbToLinear, formatDb } from '../waveform.js';
import { DSPOverlay } from './DSPOverlay.js';

interface TrackHeaderProps {
  session: Session;
  track: TrackMirror;
  height: number;
}

/**
 * Compact track header rendered to the left of each track lane.
 * Contains: name, volume (dB), pan, mute, solo, and a DSP overlay button.
 */
export function TrackHeader({ session, track, height }: TrackHeaderProps) {
  const [localDb, setLocalDb] = useState(() => linearToDb(track.gain));
  const [localPan, setLocalPan] = useState(track.pan);
  const gainDragging = useRef(false);
  const panDragging = useRef(false);

  // DSP overlay state
  const [showDSP, setShowDSP] = useState(false);
  const [dspAnchorRect, setDspAnchorRect] = useState<DOMRect | null>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!gainDragging.current) setLocalDb(linearToDb(track.gain));
  }, [track.gain]);

  useEffect(() => {
    if (!panDragging.current) setLocalPan(track.pan);
  }, [track.pan]);

  const handleDSPClose = useCallback(() => {
    setShowDSP(false);
    setDspAnchorRect(null);
  }, []);

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
        {/* Volume (dB) */}
        <div className="th-param-row">
          <label>Vol</label>
          <input
            type="range" min={-60} max={6} step={0.1}
            value={localDb}
            onMouseDown={() => { gainDragging.current = true; }}
            onChange={e => {
              const db = parseFloat(e.target.value);
              setLocalDb(db);
              const linear = dbToLinear(db);
              for (const r of session.regionsForTrack(track.stableId)) {
                session.getEngine().setGain(r.engineSlot, linear);
              }
            }}
            onMouseUp={e => {
              gainDragging.current = false;
              const db = parseFloat((e.target as HTMLInputElement).value);
              session.execute(session.makeSetGain(track.stableId, dbToLinear(db)));
            }}
          />
          <span>{formatDb(localDb)}</span>
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

        {/* Mute / Solo / DSP */}
        <div className="th-btn-row">
          <button
            className={`btn-mute${track.muted ? ' active' : ''}`}
            onClick={() => session.execute(session.makeSetMute(track.stableId, !track.muted))}
          >M</button>
          <button
            className={`btn-solo${track.soloed ? ' active' : ''}`}
            onClick={() => session.execute(session.makeSetSolo(track.stableId, !track.soloed))}
          >S</button>
          <button
            ref={chevronRef}
            className={`btn-dsp${showDSP ? ' active' : ''}`}
            onClick={() => {
              if (showDSP) { handleDSPClose(); return; }
              const rect = chevronRef.current!.getBoundingClientRect();
              setDspAnchorRect(rect);
              setShowDSP(true);
            }}
            aria-label="Open DSP panel"
          >›</button>
        </div>
      </div>

      {/* Portal — renders into document.body, so layout is unaffected */}
      {showDSP && dspAnchorRect && (
        <DSPOverlay
          session={session}
          track={track}
          anchorRect={dspAnchorRect}
          onClose={handleDSPClose}
        />
      )}
    </div>
  );
}
