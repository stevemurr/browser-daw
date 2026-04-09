/*
 * CSS for LimiterPanel — paste into src/index.css:
 *
 * ── Limiter panel ────────────────────────────────────────────────── *
 * .limiter-panel { display: flex; flex-direction: column; gap: 4px; padding: 0 0 4px; }
 * .limiter-row { display: flex; align-items: center; gap: 6px; }
 * .limiter-row-label { font-size: 0.6rem; color: #555; min-width: 50px; }
 * .limiter-value { font-size: 0.65rem; color: #666; min-width: 36px; text-align: right; flex-shrink: 0; }
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { LimiterPlugin } from '../plugins/limiter.plugin.js';

interface Props {
  session: Session;
  track: TrackMirror;
}

// ── Slider geometry (matches CompressorPanel) ─────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export function LimiterPanel({ session, track }: Props) {
  const plug = track.plugins['limiter'] ?? {};

  const [threshold, setThreshold] = useState<number>(() => plug['threshold'] ?? -0.3);
  const [release,   setRelease]   = useState<number>(() => plug['release']   ?? 100);
  const [enabled,   setEnabled]   = useState<boolean>(() => (plug['enabled'] ?? 1) >= 0.5);

  const draggingThreshold = useRef(false);
  const draggingRelease   = useRef(false);
  const thresholdRef      = useRef(threshold);
  const releaseRef        = useRef(release);
  thresholdRef.current    = threshold;
  releaseRef.current      = release;

  const threshCanvasRef = useRef<HTMLCanvasElement>(null);
  const releaseCanvasRef = useRef<HTMLCanvasElement>(null);

  // Sync from session when not dragging
  useEffect(() => {
    if (!draggingThreshold.current) setThreshold(plug['threshold'] ?? -0.3);
    if (!draggingRelease.current)   setRelease(plug['release']   ?? 100);
    setEnabled((plug['enabled'] ?? 1) >= 0.5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.plugins]);

  // ── Engine helpers ───────────────────────────────────────────────────────────

  const setEngineParam = useCallback((cParamId: number, value: number) => {
    for (const r of session.regionsForTrack(track.stableId)) {
      session.getEngine().setPluginParam(
        r.engineSlot, LimiterPlugin.pluginId, cParamId, value,
      );
    }
  }, [session, track.stableId]);

  // ── Draw threshold slider ────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = threshCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const cy = CH / 2;
    const tx = valueToX(threshold, -24, 0);
    const inactive = !enabled;

    // Groove
    const gy = cy - TRACK_H / 2;
    ctx.beginPath();
    ctx.roundRect(PAD_X, gy, CW - PAD_X * 2, TRACK_H, TRACK_H / 2);
    ctx.fillStyle = '#1a1a28';
    ctx.fill();

    // Filled portion — dark red → red gradient
    const fillW = tx - PAD_X;
    if (fillW > 0) {
      const fillGrad = ctx.createLinearGradient(PAD_X, 0, CW - PAD_X, 0);
      if (inactive) {
        fillGrad.addColorStop(0, '#2a2a3a');
        fillGrad.addColorStop(1, '#3a3a50');
      } else {
        fillGrad.addColorStop(0, '#2a0808');
        fillGrad.addColorStop(1, '#c03030');
      }
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(PAD_X, gy, fillW, TRACK_H, TRACK_H / 2);
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
  }, [threshold, enabled]);

  // ── Draw release slider ──────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = releaseCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const cy = CH / 2;
    const tx = valueToX(release, 10, 500);
    const inactive = !enabled;

    const gy = cy - TRACK_H / 2;
    ctx.beginPath();
    ctx.roundRect(PAD_X, gy, CW - PAD_X * 2, TRACK_H, TRACK_H / 2);
    ctx.fillStyle = '#1a1a28';
    ctx.fill();

    // Filled portion — dark blue → cyan gradient
    const fillW = tx - PAD_X;
    if (fillW > 0) {
      const fillGrad = ctx.createLinearGradient(PAD_X, 0, CW - PAD_X, 0);
      if (inactive) {
        fillGrad.addColorStop(0, '#2a2a3a');
        fillGrad.addColorStop(1, '#3a3a50');
      } else {
        fillGrad.addColorStop(0, '#0a1a2a');
        fillGrad.addColorStop(1, '#2080a0');
      }
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(PAD_X, gy, fillW, TRACK_H, TRACK_H / 2);
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
  }, [release, enabled]);

  // ── Mouse interaction — threshold ────────────────────────────────────────────

  const pickThreshold = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent): number => {
    const rect = threshCanvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (CW / rect.width);
    return xToValue(x, -24, 0);
  }, []);

  const handleThresholdMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    draggingThreshold.current = true;
    const v = pickThreshold(e);
    setThreshold(v);
    setEngineParam(1 /* LIM_PARAM_THRESHOLD */, v);
  }, [pickThreshold, setEngineParam]);

  // ── Mouse interaction — release ──────────────────────────────────────────────

  const pickRelease = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent): number => {
    const rect = releaseCanvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (CW / rect.width);
    return xToValue(x, 10, 500);
  }, []);

  const handleReleaseMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    draggingRelease.current = true;
    const v = pickRelease(e);
    setRelease(v);
    setEngineParam(2 /* LIM_PARAM_RELEASE */, v);
  }, [pickRelease, setEngineParam]);

  // ── Global mouse move/up listeners ──────────────────────────────────────────

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (draggingThreshold.current) {
        const rect = threshCanvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = (e.clientX - rect.left) * (CW / rect.width);
        const v = xToValue(x, -24, 0);
        setThreshold(v);
        setEngineParam(1, v);
      }
      if (draggingRelease.current) {
        const rect = releaseCanvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = (e.clientX - rect.left) * (CW / rect.width);
        const v = xToValue(x, 10, 500);
        setRelease(v);
        setEngineParam(2, v);
      }
    }
    function onUp() {
      if (draggingThreshold.current) {
        draggingThreshold.current = false;
        session.execute(
          session.makeSetPluginParam(track.stableId, LimiterPlugin, 'threshold', thresholdRef.current),
        );
      }
      if (draggingRelease.current) {
        draggingRelease.current = false;
        session.execute(
          session.makeSetPluginParam(track.stableId, LimiterPlugin, 'release', releaseRef.current),
        );
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [session, track.stableId, setEngineParam]);

  // ── Value formatters ─────────────────────────────────────────────────────────

  function fmtThreshold(v: number): string {
    const s = v.toFixed(1);
    return (v > 0 ? '+' + s : s) + ' dB';
  }
  function fmtRelease(v: number): string {
    return Math.round(v) + ' ms';
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="limiter-panel">
      <div className="dsp-module-header">
        <button
          className={`btn-bypass${enabled ? ' active' : ''}`}
          onClick={() => {
            const next = enabled ? 0 : 1;
            setEnabled(!enabled);
            session.execute(
              session.makeSetPluginParam(track.stableId, LimiterPlugin, 'enabled', next),
            );
          }}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="limiter-row">
        <span className="limiter-row-label">Threshold</span>
        <canvas
          ref={threshCanvasRef}
          className="limiter-slider"
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleThresholdMouseDown}
          onDoubleClick={() => {
            setThreshold(-0.3);
            setEngineParam(1, -0.3);
            session.execute(
              session.makeSetPluginParam(track.stableId, LimiterPlugin, 'threshold', -0.3),
            );
          }}
        />
        <span className="limiter-value">{fmtThreshold(threshold)}</span>
      </div>

      <div className="limiter-row">
        <span className="limiter-row-label">Release</span>
        <canvas
          ref={releaseCanvasRef}
          className="limiter-slider"
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleReleaseMouseDown}
          onDoubleClick={() => {
            setRelease(100);
            setEngineParam(2, 100);
            session.execute(
              session.makeSetPluginParam(track.stableId, LimiterPlugin, 'release', 100),
            );
          }}
        />
        <span className="limiter-value">{fmtRelease(release)}</span>
      </div>
    </div>
  );
}
