import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { EQPanel } from './EQPanel.js';
import { CompressorPanel } from './CompressorPanel.js';
import { DistortionPanel } from './DistortionPanel.js';
import { LimiterPanel } from './LimiterPanel.js';
import { DelayPanel } from './DelayPanel.js';
import { ChorusPanel } from './ChorusPanel.js';
import { ReverbPanel } from './ReverbPanel.js';

interface DSPOverlayProps {
  session: Session;
  track: TrackMirror;
  /** Snapshot of the chevron button's bounding rect, taken at click time. */
  anchorRect: DOMRect;
  onClose: () => void;
}

const OVERLAY_WIDTH      = 660;
const OVERLAY_MAX_HEIGHT = 560;
const MARGIN = 8;

export function DSPOverlay({ session, track, anchorRect, onClose }: DSPOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Position: open to the right of the anchor; flip left if near viewport right edge.
  let left = anchorRect.right + MARGIN;
  if (left + OVERLAY_WIDTH > window.innerWidth) left = anchorRect.left - OVERLAY_WIDTH - MARGIN;
  let top = anchorRect.top;
  if (top + OVERLAY_MAX_HEIGHT > window.innerHeight) top = window.innerHeight - OVERLAY_MAX_HEIGHT - MARGIN;

  // Close on click outside the overlay.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onClose]);

  return createPortal(
    <div
      ref={overlayRef}
      className="dsp-overlay"
      style={{ left, top, width: OVERLAY_WIDTH }}
    >
      <div className="dsp-overlay-header">
        <span className="dsp-overlay-title">{track.name.replace(/\.[^.]+$/, '')}</span>
        <button className="dsp-overlay-close" onClick={onClose} aria-label="Close DSP panel">✕</button>
      </div>

      <div className="dsp-overlay-body">
        {/* Left column: tone shaping chain */}
        <div className="dsp-overlay-col">
          <section className="dsp-overlay-section">
            <div className="dsp-overlay-section-label">EQ</div>
            <EQPanel session={session} track={track} />
          </section>
          <section className="dsp-overlay-section">
            <div className="dsp-overlay-section-label">Drive</div>
            <DistortionPanel session={session} track={track} />
          </section>
          <section className="dsp-overlay-section">
            <div className="dsp-overlay-section-label">Compressor</div>
            <CompressorPanel session={session} track={track} />
          </section>
          <section className="dsp-overlay-section">
            <div className="dsp-overlay-section-label">Limiter</div>
            <LimiterPanel session={session} track={track} />
          </section>
        </div>

        {/* Right column: time-based effects */}
        <div className="dsp-overlay-col">
          <section className="dsp-overlay-section">
            <div className="dsp-overlay-section-label">Delay</div>
            <DelayPanel session={session} track={track} />
          </section>
          <section className="dsp-overlay-section">
            <div className="dsp-overlay-section-label">Chorus</div>
            <ChorusPanel session={session} track={track} />
          </section>
          <section className="dsp-overlay-section">
            <div className="dsp-overlay-section-label">Reverb</div>
            <ReverbPanel session={session} track={track} />
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
