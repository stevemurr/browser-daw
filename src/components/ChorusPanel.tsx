/*
 * CSS for ChorusPanel — paste into src/index.css:
 *
 * ── Chorus panel ─────────────────────────────────────────────────── *
 * .chorus-panel { display: flex; flex-direction: column; gap: 4px; padding: 0 0 4px; }
 * .chorus-row { display: flex; align-items: center; gap: 6px; }
 * .chorus-row-label { font-size: 0.6rem; color: #555; min-width: 32px; }
 * .chorus-value { font-size: 0.65rem; color: #666; min-width: 44px; text-align: right; flex-shrink: 0; }
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { ChorusPlugin } from '../plugins/chorus.plugin.js';

interface Props {
  session: Session;
  track: TrackMirror;
}

// ── Slider geometry (matches CompressorPanel / DistortionPanel) ───────────────

const CW      = 200;
const CH      = 20;
const TRACK_H = 8;
const THUMB_R = 7;
const PAD_X   = THUMB_R + 1;

function valueToX(v: number, min: number, max: number): number {
  return PAD_X + ((v - min) / (max - min)) * (CW - PAD_X * 2);
}
function xToValue(x: number, min: number, max: number): number {
  const raw = min + ((x - PAD_X) / (CW - PAD_X * 2)) * (max - min);
  return Math.max(min, Math.min(max, raw));
}

// ── Draw a single slider canvas ───────────────────────────────────────────────

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

  // Groove background
  ctx.beginPath();
  ctx.roundRect(PAD_X, gy, CW - PAD_X * 2, TRACK_H, TRACK_H / 2);
  ctx.fillStyle = '#1a1a28';
  ctx.fill();

  // Filled portion
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

  // Thumb
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

// ── Component ─────────────────────────────────────────────────────────────────

export function ChorusPanel({ session, track }: Props) {
  const plug = track.plugins['chorus'] ?? {};

  const [rate,    setRate]    = useState<number>(() => plug['rate']    ?? 0.5);
  const [depth,   setDepth]   = useState<number>(() => plug['depth']   ?? 40);
  const [mix,     setMix]     = useState<number>(() => plug['mix']     ?? 50);
  const [enabled, setEnabled] = useState<boolean>(() => (plug['enabled'] ?? 1) >= 0.5);

  // Live refs for commit-on-mouseup
  const rateRef  = useRef(rate);
  rateRef.current = rate;
  const depthRef = useRef(depth);
  depthRef.current = depth;
  const mixRef   = useRef(mix);
  mixRef.current = mix;

  // Dragging guards to suppress session sync during interaction
  const draggingRate  = useRef(false);
  const draggingDepth = useRef(false);
  const draggingMix   = useRef(false);

  const rateCanvasRef  = useRef<HTMLCanvasElement>(null);
  const depthCanvasRef = useRef<HTMLCanvasElement>(null);
  const mixCanvasRef   = useRef<HTMLCanvasElement>(null);

  // Sync from session when not dragging
  useEffect(() => {
    if (!draggingRate.current)  setRate (plug['rate']    ?? 0.5);
    if (!draggingDepth.current) setDepth(plug['depth']   ?? 40);
    if (!draggingMix.current)   setMix  (plug['mix']     ?? 50);
    setEnabled((plug['enabled'] ?? 1) >= 0.5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.plugins]);

  // Draw rate slider — violet → cyan
  useEffect(() => {
    if (rateCanvasRef.current) {
      drawSlider(rateCanvasRef.current, rate, 0.1, 5.0, '#5020a0', '#20c0c0', enabled);
    }
  }, [rate, enabled]);

  // Draw depth slider — dark → purple
  useEffect(() => {
    if (depthCanvasRef.current) {
      drawSlider(depthCanvasRef.current, depth, 0, 100, '#1a1020', '#9040c0', enabled);
    }
  }, [depth, enabled]);

  // Draw mix slider — gray → silver
  useEffect(() => {
    if (mixCanvasRef.current) {
      drawSlider(mixCanvasRef.current, mix, 0, 100, '#282828', '#909090', enabled);
    }
  }, [mix, enabled]);

  // ── Engine helper ─────────────────────────────────────────────────────────────

  const setEngineParam = useCallback((cParamId: number, value: number) => {
    for (const r of session.regionsForTrack(track.stableId)) {
      session.getEngine().setPluginParam(r.engineSlot, ChorusPlugin.pluginId, cParamId, value);
    }
  }, [session, track.stableId]);

  // ── Coordinate helper ─────────────────────────────────────────────────────────

  function canvasX(e: React.MouseEvent<HTMLCanvasElement> | MouseEvent, canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    return (e.clientX - rect.left) * (CW / rect.width);
  }

  // ── Rate slider interaction ───────────────────────────────────────────────────

  const handleRateDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    draggingRate.current = true;
    const v = xToValue(canvasX(e, rateCanvasRef.current!), 0.1, 5.0);
    setRate(v);
    setEngineParam(1 /* CHORUS_PARAM_RATE */, v);
  }, [setEngineParam]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRate.current || !rateCanvasRef.current) return;
      const v = xToValue(canvasX(e, rateCanvasRef.current), 0.1, 5.0);
      setRate(v);
      setEngineParam(1, v);
    }
    function onUp() {
      if (!draggingRate.current) return;
      draggingRate.current = false;
      session.execute(session.makeSetPluginParam(track.stableId, ChorusPlugin, 'rate', rateRef.current));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [session, track.stableId, setEngineParam]);

  // ── Depth slider interaction ──────────────────────────────────────────────────

  const handleDepthDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    draggingDepth.current = true;
    const v = xToValue(canvasX(e, depthCanvasRef.current!), 0, 100);
    setDepth(v);
    setEngineParam(2 /* CHORUS_PARAM_DEPTH */, v);
  }, [setEngineParam]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingDepth.current || !depthCanvasRef.current) return;
      const v = xToValue(canvasX(e, depthCanvasRef.current), 0, 100);
      setDepth(v);
      setEngineParam(2, v);
    }
    function onUp() {
      if (!draggingDepth.current) return;
      draggingDepth.current = false;
      session.execute(session.makeSetPluginParam(track.stableId, ChorusPlugin, 'depth', depthRef.current));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [session, track.stableId, setEngineParam]);

  // ── Mix slider interaction ────────────────────────────────────────────────────

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
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [session, track.stableId, setEngineParam]);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="chorus-panel">
      <div className="dsp-module-header">
        <button
          className={`btn-bypass${enabled ? ' active' : ''}`}
          onClick={() => {
            const next = enabled ? 0 : 1;
            setEnabled(!enabled);
            setEngineParam(0 /* CHORUS_PARAM_ENABLED */, next);
            session.execute(session.makeSetPluginParam(track.stableId, ChorusPlugin, 'enabled', next));
          }}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Rate slider */}
      <div className="chorus-row">
        <span className="chorus-row-label">Rate</span>
        <canvas
          ref={rateCanvasRef}
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleRateDown}
          onDoubleClick={() => {
            setRate(0.5);
            setEngineParam(1, 0.5);
            session.execute(session.makeSetPluginParam(track.stableId, ChorusPlugin, 'rate', 0.5));
          }}
        />
        <span className="chorus-value">{rate.toFixed(2)} Hz</span>
      </div>

      {/* Depth slider */}
      <div className="chorus-row">
        <span className="chorus-row-label">Depth</span>
        <canvas
          ref={depthCanvasRef}
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleDepthDown}
          onDoubleClick={() => {
            setDepth(40);
            setEngineParam(2, 40);
            session.execute(session.makeSetPluginParam(track.stableId, ChorusPlugin, 'depth', 40));
          }}
        />
        <span className="chorus-value">{Math.round(depth)} %</span>
      </div>

      {/* Mix slider */}
      <div className="chorus-row">
        <span className="chorus-row-label">Mix</span>
        <canvas
          ref={mixCanvasRef}
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleMixDown}
          onDoubleClick={() => {
            setMix(50);
            setEngineParam(3, 50);
            session.execute(session.makeSetPluginParam(track.stableId, ChorusPlugin, 'mix', 50));
          }}
        />
        <span className="chorus-value">{Math.round(mix)} %</span>
      </div>
    </div>
  );
}
