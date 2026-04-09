import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { CompressorPlugin } from '../plugins/compressor.plugin.js';

interface Props {
  session: Session;
  track: TrackMirror;
}

// ── Slider geometry ───────────────────────────────────────────────────────────

const CW      = 200;  // canvas CSS width
const CH      = 20;   // canvas CSS height
const TRACK_H = 8;    // groove height
const THUMB_R = 7;    // thumb radius
const PAD_X   = THUMB_R + 1;  // horizontal inset so thumb doesn't clip

function valueToX(v: number): number {
  return PAD_X + (v / 100) * (CW - PAD_X * 2);
}
function xToValue(x: number): number {
  return Math.max(0, Math.min(100, ((x - PAD_X) / (CW - PAD_X * 2)) * 100));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CompressorPanel({ session, track }: Props) {
  const comp = track.plugins['compressor'] ?? {};
  const [amount,  setAmount]  = useState<number>(() => comp['amount']  ?? 0);
  const [enabled, setEnabled] = useState<boolean>(() => (comp['enabled'] ?? 1) >= 0.5);

  const dragging    = useRef(false);
  const amountRef   = useRef(amount);
  amountRef.current = amount;

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Sync from session when not dragging
  useEffect(() => {
    if (dragging.current) return;
    setAmount(comp['amount']  ?? 0);
    setEnabled((comp['enabled'] ?? 1) >= 0.5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.plugins]);

  // ── Draw slider ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const cy = CH / 2;
    const tx = valueToX(amount);
    const inactive = !enabled;

    // Background track groove
    const gy = cy - TRACK_H / 2;
    ctx.beginPath();
    ctx.roundRect(PAD_X, gy, CW - PAD_X * 2, TRACK_H, TRACK_H / 2);
    ctx.fillStyle = '#1a1a28';
    ctx.fill();

    // Filled portion — teal → lime → amber gradient clipped to thumb position
    if (amount > 0.5) {
      const fillGrad = ctx.createLinearGradient(PAD_X, 0, CW - PAD_X, 0);
      if (inactive) {
        fillGrad.addColorStop(0,   '#2a2a3a');
        fillGrad.addColorStop(1,   '#3a3a50');
      } else {
        fillGrad.addColorStop(0,   '#20a080');
        fillGrad.addColorStop(0.5, '#70b040');
        fillGrad.addColorStop(1,   '#d08020');
      }
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(PAD_X, gy, tx - PAD_X, TRACK_H, TRACK_H / 2);
      ctx.clip();
      ctx.fillStyle = fillGrad;
      ctx.fillRect(PAD_X, gy, CW, TRACK_H);
      ctx.restore();
    }

    // Thumb
    ctx.beginPath();
    ctx.arc(tx, cy, THUMB_R, 0, Math.PI * 2);
    const thumbGrad = ctx.createRadialGradient(tx - 2, cy - 2, 1, tx, cy, THUMB_R);
    thumbGrad.addColorStop(0, inactive ? '#555' : '#e0e8f0');
    thumbGrad.addColorStop(1, inactive ? '#333' : '#8090a8');
    ctx.fillStyle = thumbGrad;
    ctx.fill();
    ctx.strokeStyle = inactive ? '#444' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [amount, enabled]);

  // ── Interaction ──────────────────────────────────────────────────────────────

  const setEngineAmount = useCallback((v: number) => {
    for (const r of session.regionsForTrack(track.stableId)) {
      session.getEngine().setPluginParam(
        r.engineSlot, CompressorPlugin.pluginId, 1 /* COMP_PARAM_AMOUNT */, v,
      );
    }
  }, [session, track.stableId]);

  const pickValue = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent): number => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (CW / rect.width);
    return xToValue(x);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    dragging.current = true;
    const v = pickValue(e);
    setAmount(v);
    setEngineAmount(v);
  }, [pickValue, setEngineAmount]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = (e.clientX - rect.left) * (CW / rect.width);
      const v = xToValue(x);
      setAmount(v);
      setEngineAmount(v);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      session.execute(
        session.makeSetPluginParam(track.stableId, CompressorPlugin, 'amount', amountRef.current),
      );
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [session, track.stableId, setEngineAmount]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="compressor-panel">
      <div className="dsp-module-header">
        <button
          className={`btn-bypass${enabled ? ' active' : ''}`}
          onClick={() => {
            const next = enabled ? 0 : 1;
            setEnabled(!enabled);
            session.execute(
              session.makeSetPluginParam(track.stableId, CompressorPlugin, 'enabled', next),
            );
          }}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <div className="compressor-slider-row">
        <canvas
          ref={canvasRef}
          className="compressor-slider"
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleMouseDown}
          onDoubleClick={() => {
            setAmount(0);
            setEngineAmount(0);
            session.execute(
              session.makeSetPluginParam(track.stableId, CompressorPlugin, 'amount', 0),
            );
          }}
        />
        <span className="compressor-value">{Math.round(amount)}</span>
      </div>
    </div>
  );
}
