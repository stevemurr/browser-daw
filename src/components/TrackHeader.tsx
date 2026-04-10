import { useState, useRef, useCallback } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { DSPOverlay } from './DSPOverlay.js';
import { GainPanPad } from './GainPanPad.js';

interface TrackHeaderProps {
  session: Session;
  track: TrackMirror;
  height: number;
}

/**
 * Compact track header rendered to the left of each track lane.
 * Contains: name, gain/pan XY pad, mute, solo, and a DSP overlay button.
 */
export function TrackHeader({ session, track, height }: TrackHeaderProps) {
  const [showDSP, setShowDSP] = useState(false);
  const [dspAnchorRect, setDspAnchorRect] = useState<DOMRect | null>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);

  const handleDSPClose = useCallback(() => {
    setShowDSP(false);
    setDspAnchorRect(null);
  }, []);

  return (
    <div
      className={`track-header${track.muted ? ' muted' : ''}${track.soloed ? ' soloed' : ''}`}
      style={{ height }}
    >
      <div className="track-header-name" title={track.name}>
        {track.name.replace(/\.[^.]+$/, '').slice(0, 16)}
      </div>

      <GainPanPad session={session} track={track} />

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
