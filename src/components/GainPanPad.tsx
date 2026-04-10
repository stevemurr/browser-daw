import { useState, useEffect, useRef } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { linearToDb, dbToLinear, formatDb } from '../waveform.js';

interface Props {
  session: Session;
  track: TrackMirror;
}

const DB_MIN = -60;
const DB_MAX = 6;
const DB_RANGE = DB_MAX - DB_MIN;
const DOT_D = 12;

// ── Y-axis curve ────────────────────────────────────────────────────────────
// CURVE > 1 compresses the top: equal visual distance = finer dB change at the
// top, coarser at the bottom.  CURVE=2 makes the bottom half of the pad cover
// ~75% of the dB range (coarse/linear feel) and the top half cover only ~25%
// (fine feel).
const CURVE = 2;

function normToDbCurved(norm: number): number {
  // norm 0=bottom(quiet), 1=top(loud)
  const curved = 1 - Math.pow(1 - norm, CURVE);
  return DB_MIN + curved * DB_RANGE;
}

function dbToNormCurved(db: number): number {
  const linear = Math.max(0, Math.min(1, (db - DB_MIN) / DB_RANGE));
  return 1 - Math.pow(1 - linear, 1 / CURVE);
}

// ── Pan helpers ─────────────────────────────────────────────────────────────
function panToNormX(pan: number): number { return (pan + 1) / 2; }
function normXToPan(n: number):   number { return n * 2 - 1; }

// ── Dot inset position ──────────────────────────────────────────────────────
// Maps a 0–1 value into a CSS calc() that keeps the dot fully inside the pad.
function insetCalc(norm: number): string {
  return `calc(${DOT_D / 2}px + ${norm.toFixed(5)} * (100% - ${DOT_D}px))`;
}

// ── 6 dB band gradient (static — depends only on constants) ─────────────────
// Alternating light/dark hard-edge stripes at every 6 dB boundary.
// The bands are NOT equal height: upper bands are taller because the curve
// stretches that region, visually reinforcing the "fine control" zone.
const BAND_DB_MARKS = [6, 0, -6, -12, -18, -24, -30, -36, -42, -48, -54, -60];

const BAND_GRADIENT = (() => {
  const pcts = BAND_DB_MARKS.map(db => {
    const normY = dbToNormCurved(db);
    return ((1 - normY) * 100).toFixed(3); // % from top of pad
  });

  const stops: string[] = [];
  for (let i = 0; i < pcts.length - 1; i++) {
    const from = pcts[i];
    const to   = pcts[i + 1];
    // Alternate: even bands slightly lighter, odd bands transparent
    const col  = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0)';
    stops.push(`${col} ${from}%`, `${col} ${to}%`);
  }
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
})();

// ── Component ────────────────────────────────────────────────────────────────
export function GainPanPad({ session, track }: Props) {
  const [localDb,  setLocalDb]  = useState(() => linearToDb(track.gain));
  const [localPan, setLocalPan] = useState(track.pan);

  const dragging    = useRef(false);
  const localDbRef  = useRef(localDb);
  const localPanRef = useRef(localPan);
  localDbRef.current  = localDb;
  localPanRef.current = localPan;

  useEffect(() => {
    if (!dragging.current) setLocalDb(linearToDb(track.gain));
  }, [track.gain]);

  useEffect(() => {
    if (!dragging.current) setLocalPan(track.pan);
  }, [track.pan]);

  function applyClientPos(el: HTMLElement, clientX: number, clientY: number) {
    const rect  = el.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const yNorm = Math.max(0, Math.min(1, (clientY - rect.top)  / rect.height));

    const pan  = normXToPan(xNorm);
    const db   = normToDbCurved(1 - yNorm);   // top = loud
    const gain = dbToLinear(db);

    setLocalDb(db);
    setLocalPan(pan);

    for (const r of session.regionsForTrack(track.stableId)) {
      session.getEngine().setGain(r.engineSlot, gain);
      session.getEngine().setPan(r.engineSlot, pan);
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    applyClientPos(e.currentTarget, e.clientX, e.clientY);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    applyClientPos(e.currentTarget, e.clientX, e.clientY);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    dragging.current = false;
    session.execute(
      session.makeSetGainAndPan(
        track.stableId,
        dbToLinear(localDbRef.current),
        localPanRef.current,
      ),
    );
  }

  // ── Derived display values ──────────────────────────────────────────────
  const xNorm = panToNormX(localPan);
  const yNorm = dbToNormCurved(localDb);  // curved position for display

  const dotLeft = insetCalc(xNorm);
  const dotTop  = insetCalc(1 - yNorm);

  // Node color: quiet → muted gray-blue, loud → red
  const nodeR = Math.round(80  + yNorm * 140);
  const nodeG = Math.round(90  - yNorm * 35);
  const nodeB = Math.round(105 - yNorm * 50);
  const dotColor  = `rgb(${nodeR},${nodeG},${nodeB})`;
  const dotShadow = `0 0 5px rgba(${nodeR},${nodeG},${nodeB},0.5)`;

  // Pad background layers (front to back):
  //  1. Pan glow — bleeds in from left (blue) or right (green)
  //  2. Warm top tint — subtle amber wash in the loud zone
  //  3. 6 dB alternating bands
  //  4. Base color
  const leftBias  = Math.max(0, 0.5 - xNorm) * 2;
  const rightBias = Math.max(0, xNorm - 0.5) * 2;
  // Volume glow: only kicks in above -6 dB, reaches full intensity at +6 dB
  const HOT_THRESH = -6;
  const hotNorm = Math.max(0, (localDb - HOT_THRESH) / (DB_MAX - HOT_THRESH));

  const padBg = [
    `linear-gradient(to right, rgba(55,120,215,${(leftBias  * 0.4).toFixed(3)}), transparent)`,
    `linear-gradient(to left,  rgba(55,195,90, ${(rightBias * 0.4).toFixed(3)}), transparent)`,
    `linear-gradient(to bottom, rgba(210,70,30,${(hotNorm * 0.45).toFixed(3)}), transparent 60%)`,
    BAND_GRADIENT,
    '#141414',
  ].join(', ');

  // Guide line positions use the curved scale so they match node movement
  const unityTop   = `${(1 - dbToNormCurved(0)) * 100}%`;
  const centerLeft = '50%';

  const panLabel = localPan === 0 ? 'C'
    : localPan > 0 ? `R${Math.round(localPan * 100)}`
    : `L${Math.round(-localPan * 100)}`;

  return (
    <div className="gp-wrapper">
      <div
        className="gp-pad"
        style={{ background: padBg }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="gp-guide gp-guide-v" style={{ left: centerLeft }} />
        <div className="gp-guide gp-guide-h" style={{ top: unityTop }} />

        <span className="gp-lbl gp-lbl-l">L</span>
        <span className="gp-lbl gp-lbl-r">R</span>
        <span className="gp-lbl gp-lbl-t">+</span>
        <span className="gp-lbl gp-lbl-b">−</span>

        <div
          className="gp-dot"
          style={{ left: dotLeft, top: dotTop, background: dotColor, boxShadow: dotShadow }}
        />
      </div>

      <div className="gp-readout">
        <span>{formatDb(localDb)}</span>
        <span>{panLabel}</span>
      </div>
    </div>
  );
}
