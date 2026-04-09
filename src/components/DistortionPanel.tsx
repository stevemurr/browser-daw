/*
 * CSS for this component — paste into src/index.css
 *
 * ── Distortion panel ─────────────────────────────────────────────── *
 * .distortion-panel { display: flex; flex-direction: column; gap: 4px; padding: 0 0 4px; }
 * .distortion-mode-pills { display: flex; gap: 3px; }
 * .distortion-pill {
 *   padding: 1px 7px; font-size: 0.6rem; font-family: monospace;
 *   background: #1e1e1e; border: 1px solid #3a3a3a; color: #666;
 *   cursor: pointer; border-radius: 3px;
 * }
 * .distortion-pill.active { background: #2a1a3a; border-color: #8040c0; color: #c080f0; }
 * .distortion-row { display: flex; align-items: center; gap: 6px; }
 * .distortion-row-label { font-size: 0.6rem; color: #555; min-width: 28px; }
 * .distortion-value { font-size: 0.65rem; color: #666; min-width: 22px; text-align: right; flex-shrink: 0; }
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { DistortionPlugin } from '../plugins/distortion.plugin.js';

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
  const raw = ((x - PAD_X) / (CW - PAD_X * 2)) * (max - min) + min;
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

const MODE_LABELS = ['SOFT', 'HARD', 'FUZZ'] as const;

export function DistortionPanel({ session, track }: Props) {
  const plug = track.plugins['distortion'] ?? {};

  const [drive,   setDrive]   = useState<number>(() => plug['drive']   ?? 0);
  const [mix,     setMix]     = useState<number>(() => plug['mix']     ?? 100);
  const [mode,    setMode]    = useState<number>(() => plug['mode']    ?? 0);
  const [enabled, setEnabled] = useState<boolean>(() => (plug['enabled'] ?? 1) >= 0.5);

  // Live refs for commit-on-mouseup
  const driveRef = useRef(drive);
  driveRef.current = drive;
  const mixRef = useRef(mix);
  mixRef.current = mix;

  // Dragging guards to suppress session sync during interaction
  const draggingDrive = useRef(false);
  const draggingMix   = useRef(false);

  const driveCanvasRef = useRef<HTMLCanvasElement>(null);
  const mixCanvasRef   = useRef<HTMLCanvasElement>(null);

  // Sync from session when not dragging
  useEffect(() => {
    if (!draggingDrive.current) setDrive(plug['drive']   ?? 0);
    if (!draggingMix.current)   setMix  (plug['mix']     ?? 100);
    setMode   (plug['mode']    ?? 0);
    setEnabled((plug['enabled'] ?? 1) >= 0.5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.plugins]);

  // Draw drive slider
  useEffect(() => {
    if (driveCanvasRef.current) {
      drawSlider(driveCanvasRef.current, drive, 0, 100, '#c02020', '#e06020', enabled);
    }
  }, [drive, enabled]);

  // Draw mix slider
  useEffect(() => {
    if (mixCanvasRef.current) {
      drawSlider(mixCanvasRef.current, mix, 0, 100, '#6030c0', '#a080e0', enabled);
    }
  }, [mix, enabled]);

  // ── Engine helper ─────────────────────────────────────────────────────────────

  const setEngineParam = useCallback((cParamId: number, value: number) => {
    for (const r of session.regionsForTrack(track.stableId)) {
      session.getEngine().setPluginParam(r.engineSlot, DistortionPlugin.pluginId, cParamId, value);
    }
  }, [session, track.stableId]);

  // ── Coordinate helper ─────────────────────────────────────────────────────────

  function canvasX(e: React.MouseEvent<HTMLCanvasElement> | MouseEvent, canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    return (e.clientX - rect.left) * (CW / rect.width);
  }

  // ── Drive slider interaction ──────────────────────────────────────────────────

  const handleDriveDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    draggingDrive.current = true;
    const v = xToValue(canvasX(e, driveCanvasRef.current!), 0, 100);
    setDrive(v);
    setEngineParam(1 /* DIST_PARAM_DRIVE */, v);
  }, [setEngineParam]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingDrive.current || !driveCanvasRef.current) return;
      const v = xToValue(canvasX(e, driveCanvasRef.current), 0, 100);
      setDrive(v);
      setEngineParam(1, v);
    }
    function onUp() {
      if (!draggingDrive.current) return;
      draggingDrive.current = false;
      session.execute(session.makeSetPluginParam(track.stableId, DistortionPlugin, 'drive', driveRef.current));
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
    setEngineParam(3 /* DIST_PARAM_MIX */, v);
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
      session.execute(session.makeSetPluginParam(track.stableId, DistortionPlugin, 'mix', mixRef.current));
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
    <div className="distortion-panel">
      <div className="dsp-module-header">
        {/* Mode pills */}
        <div className="distortion-mode-pills">
          {MODE_LABELS.map((label, i) => (
            <button
              key={label}
              className={`distortion-pill${mode === i ? ' active' : ''}`}
              onClick={() => {
                setMode(i);
                setEngineParam(2 /* DIST_PARAM_MODE */, i);
                session.execute(session.makeSetPluginParam(track.stableId, DistortionPlugin, 'mode', i));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Bypass */}
        <button
          className={`btn-bypass${enabled ? ' active' : ''}`}
          onClick={() => {
            const next = enabled ? 0 : 1;
            setEnabled(!enabled);
            setEngineParam(0 /* DIST_PARAM_ENABLED */, next);
            session.execute(session.makeSetPluginParam(track.stableId, DistortionPlugin, 'enabled', next));
          }}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Drive slider */}
      <div className="distortion-row">
        <span className="distortion-row-label">Drive</span>
        <canvas
          ref={driveCanvasRef}
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleDriveDown}
          onDoubleClick={() => {
            setDrive(0);
            setEngineParam(1, 0);
            session.execute(session.makeSetPluginParam(track.stableId, DistortionPlugin, 'drive', 0));
          }}
        />
        <span className="distortion-value">{Math.round(drive)}</span>
      </div>

      {/* Mix slider */}
      <div className="distortion-row">
        <span className="distortion-row-label">Mix</span>
        <canvas
          ref={mixCanvasRef}
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleMixDown}
          onDoubleClick={() => {
            setMix(100);
            setEngineParam(3, 100);
            session.execute(session.makeSetPluginParam(track.stableId, DistortionPlugin, 'mix', 100));
          }}
        />
        <span className="distortion-value">{Math.round(mix)}</span>
      </div>
    </div>
  );
}
