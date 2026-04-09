import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { ChorusPlugin } from '../plugins/chorus.plugin.js';

interface Props {
  session: Session;
  track: TrackMirror;
}

const CW      = 200;
const CH      = 20;
const TRACK_H = 8;
const THUMB_R = 7;
const PAD_X   = THUMB_R + 1;

function valueToX(v: number, min: number, max: number): number {
  return PAD_X + ((v - min) / (max - min)) * (CW - PAD_X * 2);
}
function xToValue(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, min + ((x - PAD_X) / (CW - PAD_X * 2)) * (max - min)));
}

function drawSlider(
  canvas: HTMLCanvasElement,
  value: number,
  min: number,
  max: number,
  gradStart: string,
  gradEnd: string,
  enabled: boolean,
) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.round(CW * dpr);
  canvas.height = Math.round(CH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const cy = CH / 2;
  const tx = valueToX(value, min, max);
  const gy = cy - TRACK_H / 2;

  ctx.beginPath();
  ctx.roundRect(PAD_X, gy, CW - PAD_X * 2, TRACK_H, TRACK_H / 2);
  ctx.fillStyle = '#1a1a28';
  ctx.fill();

  if (value > min + (max - min) * 0.005) {
    const fillGrad = ctx.createLinearGradient(PAD_X, 0, CW - PAD_X, 0);
    if (!enabled) {
      fillGrad.addColorStop(0, '#2a2a3a');
      fillGrad.addColorStop(1, '#3a3a50');
    } else {
      fillGrad.addColorStop(0, gradStart);
      fillGrad.addColorStop(1, gradEnd);
    }
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(PAD_X, gy, tx - PAD_X, TRACK_H, TRACK_H / 2);
    ctx.clip();
    ctx.fillStyle = fillGrad;
    ctx.fillRect(PAD_X, gy, CW, TRACK_H);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(tx, cy, THUMB_R, 0, Math.PI * 2);
  const thumbGrad = ctx.createRadialGradient(tx - 2, cy - 2, 1, tx, cy, THUMB_R);
  thumbGrad.addColorStop(0, !enabled ? '#555' : '#e0e8f0');
  thumbGrad.addColorStop(1, !enabled ? '#333' : '#8090a8');
  ctx.fillStyle = thumbGrad;
  ctx.fill();
  ctx.strokeStyle = !enabled ? '#444' : 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function ChorusPanel({ session, track }: Props) {
  const plug = track.plugins['chorus'] ?? {};

  const [size,    setSize]    = useState<number>(() => plug['size'] ?? 50);
  const [mix,     setMix]     = useState<number>(() => plug['mix']  ?? 0);
  const [enabled, setEnabled] = useState<boolean>(() => (plug['enabled'] ?? 1) >= 0.5);

  const sizeRef = useRef(size);
  sizeRef.current = size;
  const mixRef  = useRef(mix);
  mixRef.current = mix;

  const draggingSize = useRef(false);
  const draggingMix  = useRef(false);

  const sizeCanvasRef = useRef<HTMLCanvasElement>(null);
  const mixCanvasRef  = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!draggingSize.current) setSize(plug['size'] ?? 50);
    if (!draggingMix.current)  setMix(plug['mix']  ?? 0);
    setEnabled((plug['enabled'] ?? 1) >= 0.5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.plugins]);

  // Size: violet → teal
  useEffect(() => {
    if (sizeCanvasRef.current)
      drawSlider(sizeCanvasRef.current, size, 0, 100, '#3a1060', '#20a0c0', enabled);
  }, [size, enabled]);

  // Mix: dark → silver
  useEffect(() => {
    if (mixCanvasRef.current)
      drawSlider(mixCanvasRef.current, mix, 0, 100, '#282828', '#909090', enabled);
  }, [mix, enabled]);

  const setEngineParam = useCallback((cParamId: number, value: number) => {
    for (const r of session.regionsForTrack(track.stableId))
      session.getEngine().setPluginParam(r.engineSlot, ChorusPlugin.pluginId, cParamId, value);
  }, [session, track.stableId]);

  function canvasX(e: React.MouseEvent<HTMLCanvasElement> | MouseEvent, canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    return (e.clientX - rect.left) * (CW / rect.width);
  }

  // ── Size ────────────────────────────────────────────────────────────────────
  const handleSizeDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    draggingSize.current = true;
    const v = xToValue(canvasX(e, sizeCanvasRef.current!), 0, 100);
    setSize(v);
    setEngineParam(4 /* CHORUS_PARAM_SIZE */, v);
  }, [setEngineParam]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingSize.current || !sizeCanvasRef.current) return;
      const v = xToValue(canvasX(e, sizeCanvasRef.current), 0, 100);
      setSize(v);
      setEngineParam(4, v);
    }
    function onUp() {
      if (!draggingSize.current) return;
      draggingSize.current = false;
      session.execute(session.makeSetPluginParam(track.stableId, ChorusPlugin, 'size', sizeRef.current));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [session, track.stableId, setEngineParam]);

  // ── Mix ─────────────────────────────────────────────────────────────────────
  const handleMixDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    draggingMix.current = true;
    const v = xToValue(canvasX(e, mixCanvasRef.current!), 0, 100);
    setMix(v);
    setEngineParam(3 /* CHORUS_PARAM_MIX */, v);
  }, [setEngineParam]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingMix.current || !mixCanvasRef.current) return;
      const v = xToValue(canvasX(e, mixCanvasRef.current), 0, 100);
      setMix(v);
      setEngineParam(3, v);
    }
    function onUp() {
      if (!draggingMix.current) return;
      draggingMix.current = false;
      session.execute(session.makeSetPluginParam(track.stableId, ChorusPlugin, 'mix', mixRef.current));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [session, track.stableId, setEngineParam]);

  return (
    <div className="chorus-panel">
      <div className="dsp-module-header">
        <button
          className={`btn-bypass${enabled ? ' active' : ''}`}
          onClick={() => {
            const next = enabled ? 0 : 1;
            setEnabled(!enabled);
            setEngineParam(0, next);
            session.execute(session.makeSetPluginParam(track.stableId, ChorusPlugin, 'enabled', next));
          }}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="chorus-row">
        <span className="chorus-row-label">Size</span>
        <canvas
          ref={sizeCanvasRef}
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleSizeDown}
          onDoubleClick={() => {
            setSize(50); setEngineParam(4, 50);
            session.execute(session.makeSetPluginParam(track.stableId, ChorusPlugin, 'size', 50));
          }}
        />
        <span className="chorus-value">{Math.round(size)}</span>
      </div>

      <div className="chorus-row">
        <span className="chorus-row-label">Mix</span>
        <canvas
          ref={mixCanvasRef}
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleMixDown}
          onDoubleClick={() => {
            setMix(50); setEngineParam(3, 50);
            session.execute(session.makeSetPluginParam(track.stableId, ChorusPlugin, 'mix', 50));
          }}
        />
        <span className="chorus-value">{Math.round(mix)} %</span>
      </div>
    </div>
  );
}
