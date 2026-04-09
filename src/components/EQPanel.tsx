import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { EQPlugin } from '../plugins/eq.plugin.js';

interface Props {
  session: Session;
  track: TrackMirror;
}

// ── Canvas geometry ───────────────────────────────────────────────────────────

const CW = 260;  // CSS pixels
const CH = 160;
const PAD = { t: 10, r: 10, b: 22, l: 28 };

const F_MIN = 20;
const F_MAX = 20000;
const DB_MAX = 18;
const SAMPLE_RATE = 44100;

function freqToX(f: number): number {
  const w = CW - PAD.l - PAD.r;
  return PAD.l + w * Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN);
}
function xToFreq(x: number): number {
  const w = CW - PAD.l - PAD.r;
  return F_MIN * Math.pow(F_MAX / F_MIN, (x - PAD.l) / w);
}
function gainToY(db: number): number {
  const h = CH - PAD.t - PAD.b;
  return PAD.t + h * (1 - (db + DB_MAX) / (DB_MAX * 2));
}
function yToGain(y: number): number {
  const h = CH - PAD.t - PAD.b;
  return DB_MAX * 2 * (1 - (y - PAD.t) / h) - DB_MAX;
}

// ── Biquad magnitude response (RBJ Audio EQ Cookbook) ────────────────────────

type FilterType = 'lowShelf' | 'peak' | 'highShelf';

function biquadDb(type: FilterType, fc: number, gainDb: number, Q: number, f: number): number {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * fc) / SAMPLE_RATE;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * Q);

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;

  if (type === 'lowShelf') {
    const sq = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) - (A - 1) * cosw + sq);
    b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
    b2 = A * ((A + 1) - (A - 1) * cosw - sq);
    a0 = (A + 1) + (A - 1) * cosw + sq;
    a1 = -2 * ((A - 1) + (A + 1) * cosw);
    a2 = (A + 1) + (A - 1) * cosw - sq;
  } else if (type === 'highShelf') {
    const sq = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cosw + sq);
    b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
    b2 = A * ((A + 1) + (A - 1) * cosw - sq);
    a0 = (A + 1) - (A - 1) * cosw + sq;
    a1 = 2 * ((A - 1) - (A + 1) * cosw);
    a2 = (A + 1) - (A - 1) * cosw - sq;
  } else {
    // Peaking (bell)
    b0 = 1 + alpha * A;
    b1 = -2 * cosw;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cosw;
    a2 = 1 - alpha / A;
  }

  const wt = (2 * Math.PI * f) / SAMPLE_RATE;
  const c1 = Math.cos(wt), s1 = Math.sin(wt);
  const c2 = Math.cos(2 * wt), s2 = Math.sin(2 * wt);
  const numR = b0 + b1 * c1 + b2 * c2;
  const numI = -b1 * s1 - b2 * s2;
  const denR = a0 + a1 * c1 + a2 * c2;
  const denI = -a1 * s1 - a2 * s2;
  const mag2 = (numR * numR + numI * numI) / (denR * denR + denI * denI);
  return 20 * Math.log10(Math.sqrt(Math.max(mag2, 1e-30)));
}

// ── Band descriptors ──────────────────────────────────────────────────────────

const BANDS = [
  { label: 'L', type: 'lowShelf'  as FilterType, freqId: 'band0_freq', gainId: 'band0_gain', qId: 'band0_q', freqMin: 20,   freqMax: 2000,  color: '#40c080', cFreq: 1, cGain: 2, cQ: 3 },
  { label: 'M', type: 'peak'      as FilterType, freqId: 'band1_freq', gainId: 'band1_gain', qId: 'band1_q', freqMin: 200,  freqMax: 8000,  color: '#f08040', cFreq: 4, cGain: 5, cQ: 6 },
  { label: 'H', type: 'highShelf' as FilterType, freqId: 'band2_freq', gainId: 'band2_gain', qId: 'band2_q', freqMin: 2000, freqMax: 20000, color: '#6090e8', cFreq: 7, cGain: 8, cQ: 9 },
] as const;

const NODE_R   = 7;   // visual radius
const NODE_HIT = 11;  // hit-test radius

// ── Component ─────────────────────────────────────────────────────────────────

export function EQPanel({ session, track }: Props) {
  const eq = track.plugins['eq'] ?? {};
  const [local, setLocal]       = useState<Record<string, number>>(() => ({ ...eq }));
  const [activeNode, setActiveNode] = useState<number | null>(null);

  const canvasRef   = useRef<HTMLCanvasElement>(null);

  // Drag ref holds mutable current values so the window mouseup handler can commit
  // without stale closures.
  const dragRef = useRef<{
    band: number;
    currentFreq: number;
    currentGain: number;
  } | null>(null);

  // Q wheel commit debounce
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a live ref to local so wheel commit sees current Q
  const localRef = useRef(local);
  localRef.current = local;

  // Sync from session state when not mid-drag
  useEffect(() => {
    setLocal(prev => {
      const drag = dragRef.current;
      const next = { ...prev };
      for (const key of Object.keys(eq)) {
        const isDragged = drag !== null && (
          key === BANDS[drag.band].freqId ||
          key === BANDS[drag.band].gainId
        );
        if (!isDragged) next[key] = eq[key];
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.plugins]);

  const get = (id: string): number => local[id] ?? (eq[id] ?? 0);
  const eqEnabled = get('enabled') >= 0.5;

  // ── Canvas draw ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0e0e16';
    ctx.fillRect(0, 0, CW, CH);

    const plotL = PAD.l, plotR = CW - PAD.r;
    const plotT = PAD.t, plotB = CH - PAD.b;

    // Grid — horizontal dB lines
    ctx.strokeStyle = '#1e1e2a';
    ctx.lineWidth = 1;
    for (const db of [-12, -6, 6, 12]) {
      const y = gainToY(db);
      ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
    }
    // Grid — frequency verticals
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = freqToX(f);
      ctx.beginPath(); ctx.moveTo(x, plotT); ctx.lineTo(x, plotB); ctx.stroke();
    }

    // 0 dB line
    const midY = gainToY(0);
    ctx.strokeStyle = '#2a2a3a';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plotL, midY); ctx.lineTo(plotR, midY); ctx.stroke();

    // Axis labels
    ctx.fillStyle = '#3a3a52';
    ctx.font = `9px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText('+18', plotL - 3, plotT + 4);
    ctx.fillText('0',   plotL - 3, midY + 4);
    ctx.fillText('-18', plotL - 3, plotB + 4);
    ctx.textAlign = 'center';
    for (const [f, lbl] of [[100, '100'], [1000, '1k'], [10000, '10k']] as const) {
      ctx.fillText(lbl, freqToX(f), plotB + 14);
    }

    // Compute combined curve
    const plotW = plotR - plotL;
    const curveY: number[] = [];
    for (let px = 0; px < plotW; px++) {
      const f = xToFreq(plotL + px);
      let db = 0;
      for (const band of BANDS) {
        db += biquadDb(band.type, get(band.freqId), get(band.gainId), get(band.qId), f);
      }
      curveY.push(gainToY(Math.max(-DB_MAX, Math.min(DB_MAX, db))));
    }

    // Filled area
    ctx.beginPath();
    ctx.moveTo(plotL, midY);
    for (let px = 0; px < plotW; px++) ctx.lineTo(plotL + px, curveY[px]);
    ctx.lineTo(plotR, midY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, plotT, 0, plotB);
    grad.addColorStop(0,   'rgba(64,128,200,0.22)');
    grad.addColorStop(0.5, 'rgba(64,128,200,0.06)');
    grad.addColorStop(1,   'rgba(64,128,200,0.18)');
    ctx.fillStyle = eqEnabled ? grad : 'rgba(60,60,60,0.12)';
    ctx.fill();

    // Curve stroke
    ctx.beginPath();
    for (let px = 0; px < plotW; px++) {
      if (px === 0) ctx.moveTo(plotL, curveY[px]);
      else ctx.lineTo(plotL + px, curveY[px]);
    }
    ctx.strokeStyle = eqEnabled ? '#4888d0' : '#2a2a3a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Nodes
    for (let i = 0; i < BANDS.length; i++) {
      const band = BANDS[i];
      const nx = freqToX(get(band.freqId));
      const ny = gainToY(get(band.gainId));

      if (i === activeNode) {
        ctx.beginPath();
        ctx.arc(nx, ny, NODE_R + 4, 0, Math.PI * 2);
        ctx.strokeStyle = band.color + '44';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(nx, ny, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = eqEnabled ? band.color : '#3a3a4a';
      ctx.fill();
      ctx.strokeStyle = i === activeNode ? '#fff' : 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#000';
      ctx.font = `bold 8px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(band.label, nx, ny + 3);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, activeNode, eqEnabled]);

  // ── Drag interaction ─────────────────────────────────────────────────────────

  // Convert a mouse event's position relative to the canvas CSS rect → canvas coords
  function canvasCoords(e: MouseEvent | React.MouseEvent): { ox: number; oy: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      ox: (e.clientX - rect.left) * (CW / rect.width),
      oy: (e.clientY - rect.top)  * (CH / rect.height),
    };
  }

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { ox, oy } = canvasCoords(e);
    for (let i = 0; i < BANDS.length; i++) {
      const band = BANDS[i];
      const nx = freqToX(local[band.freqId] ?? 0);
      const ny = gainToY(local[band.gainId] ?? 0);
      if (Math.hypot(ox - nx, oy - ny) <= NODE_HIT) {
        e.preventDefault();
        dragRef.current = {
          band: i,
          currentFreq: local[band.freqId] ?? 0,
          currentGain: local[band.gainId] ?? 0,
        };
        setActiveNode(i);
        return;
      }
    }
    setActiveNode(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const band = BANDS[drag.band];
      const { ox, oy } = canvasCoords(e);
      const newFreq = Math.max(band.freqMin, Math.min(band.freqMax, xToFreq(ox)));
      const newGain = Math.max(-DB_MAX, Math.min(DB_MAX, yToGain(oy)));
      drag.currentFreq = newFreq;
      drag.currentGain = newGain;
      setLocal(prev => ({ ...prev, [band.freqId]: newFreq, [band.gainId]: newGain }));
      const engine = session.getEngine();
      for (const r of session.regionsForTrack(track.stableId)) {
        engine.setPluginParam(r.engineSlot, EQPlugin.pluginId, band.cFreq, newFreq);
        engine.setPluginParam(r.engineSlot, EQPlugin.pluginId, band.cGain, newGain);
      }
    }

    function onMouseUp() {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      const band = BANDS[drag.band];
      // Commit the last values captured during move (not from stale React state)
      session.execute(session.makeSetPluginParam(track.stableId, EQPlugin, band.freqId, drag.currentFreq));
      session.execute(session.makeSetPluginParam(track.stableId, EQPlugin, band.gainId, drag.currentGain));
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [session, track.stableId]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (activeNode === null) return;
    e.preventDefault();
    const band = BANDS[activeNode];
    const step = e.deltaY > 0 ? -0.05 : 0.05;
    const curQ = localRef.current[band.qId] ?? 0.707;
    const newQ = Math.max(0.1, Math.min(4, curQ + step));
    setLocal(prev => ({ ...prev, [band.qId]: newQ }));
    const engine = session.getEngine();
    for (const r of session.regionsForTrack(track.stableId)) {
      engine.setPluginParam(r.engineSlot, EQPlugin.pluginId, band.cQ, newQ);
    }
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    const capturedNode = activeNode;
    wheelTimerRef.current = setTimeout(() => {
      const q = localRef.current[BANDS[capturedNode].qId] ?? 0.707;
      session.execute(session.makeSetPluginParam(track.stableId, EQPlugin, BANDS[capturedNode].qId, q));
    }, 400);
  }, [activeNode, session, track.stableId]);

  // ── Footer info ──────────────────────────────────────────────────────────────

  const activeBand = activeNode !== null ? BANDS[activeNode] : null;

  return (
    <div className="eq-canvas-wrap">
      <div className="dsp-module-header">
        <button
          className={`btn-bypass${eqEnabled ? ' active' : ''}`}
          onClick={() => {
            const next = eqEnabled ? 0 : 1;
            session.execute(session.makeSetPluginParam(track.stableId, EQPlugin, 'enabled', next));
          }}
        >
          {eqEnabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="eq-canvas"
        style={{ width: CW, height: CH }}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
      />
      <div className="eq-canvas-footer">
        {activeBand && (
          <span className="eq-canvas-info">
            {activeBand.label === 'L' ? 'Low' : activeBand.label === 'M' ? 'Mid' : 'High'}
            {' '}·{' '}{Math.round(local[activeBand.freqId] ?? 0)} Hz
            {' '}·{' '}{(local[activeBand.gainId] ?? 0) >= 0 ? '+' : ''}{(local[activeBand.gainId] ?? 0).toFixed(1)} dB
            {' '}·{' '}Q {(local[activeBand.qId] ?? 0.707).toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
