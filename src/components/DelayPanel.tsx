/*
 * CSS for this component — paste into src/index.css
 *
 * ── Delay panel ──────────────────────────────────────────────────────
 * .delay-panel { display: flex; flex-direction: column; gap: 4px; padding: 0 0 4px; }
 * .delay-div-row { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
 * .delay-pill {
 *   padding: 1px 6px; font-size: 0.6rem; font-family: monospace;
 *   background: #1e1e1e; border: 1px solid #3a3a3a; color: #666;
 *   cursor: pointer; border-radius: 3px;
 * }
 * .delay-pill.active { background: #0a2a1a; border-color: #20a060; color: #40c080; }
 * .delay-bpm-input {
 *   width: 38px; background: #1a1a1a; border: 1px solid #333; color: #888;
 *   font-family: monospace; font-size: 0.6rem; padding: 1px 3px; border-radius: 3px;
 *   text-align: center;
 * }
 * .delay-row { display: flex; align-items: center; gap: 6px; }
 * .delay-row-label { font-size: 0.6rem; color: #555; min-width: 48px; }
 * .delay-value { font-size: 0.65rem; color: #666; min-width: 40px; text-align: right; flex-shrink: 0; }
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { DelayPlugin } from '../plugins/delay.plugin.js';

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

// ── Note division helpers ─────────────────────────────────────────────────────

type DivMode = '1/4' | '1/8' | '1/16' | 'manual';

function divToMs(div: DivMode, bpm: number): number | null {
  if (div === 'manual') return null;
  const beat = 60000 / bpm; // ms per quarter note
  const factors: Record<Exclude<DivMode, 'manual'>, number> = {
    '1/4':  1,
    '1/8':  0.5,
    '1/16': 0.25,
  };
  const raw = beat * factors[div as Exclude<DivMode, 'manual'>];
  return Math.max(1, Math.min(2000, Math.round(raw)));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DelayPanel({ session, track }: Props) {
  const plug = track.plugins['delay'] ?? {};

  const [timeMs,   setTimeMs]   = useState<number>(() => plug['time_ms']  ?? 250);
  const [feedback, setFeedback] = useState<number>(() => plug['feedback'] ?? 35);
  const [mix,      setMix]      = useState<number>(() => plug['mix']      ?? 50);
  const [enabled,  setEnabled]  = useState<boolean>(() => (plug['enabled'] ?? 1) >= 0.5);
  const [bpm,      setBpm]      = useState<number>(120);
  const [divMode,  setDivMode]  = useState<DivMode>('manual');

  // Live refs for commit-on-mouseup
  const timeMsRef   = useRef(timeMs);
  timeMsRef.current = timeMs;
  const feedbackRef   = useRef(feedback);
  feedbackRef.current = feedback;
  const mixRef   = useRef(mix);
  mixRef.current = mix;

  // Dragging guards to suppress session sync during interaction
  const draggingTime     = useRef(false);
  const draggingFeedback = useRef(false);
  const draggingMix      = useRef(false);

  const timeCanvasRef     = useRef<HTMLCanvasElement>(null);
  const feedbackCanvasRef = useRef<HTMLCanvasElement>(null);
  const mixCanvasRef      = useRef<HTMLCanvasElement>(null);

  // Sync from session when not dragging
  useEffect(() => {
    if (!draggingTime.current)     setTimeMs  (plug['time_ms']  ?? 250);
    if (!draggingFeedback.current) setFeedback(plug['feedback'] ?? 35);
    if (!draggingMix.current)      setMix     (plug['mix']      ?? 50);
    setEnabled((plug['enabled'] ?? 1) >= 0.5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.plugins]);

  // Draw time slider
  useEffect(() => {
    if (timeCanvasRef.current) {
      drawSlider(timeCanvasRef.current, timeMs, 1, 2000, '#302060', '#20a080', enabled);
    }
  }, [timeMs, enabled]);

  // Draw feedback slider
  useEffect(() => {
    if (feedbackCanvasRef.current) {
      drawSlider(feedbackCanvasRef.current, feedback, 0, 95, '#202010', '#c08030', enabled);
    }
  }, [feedback, enabled]);

  // Draw mix slider
  useEffect(() => {
    if (mixCanvasRef.current) {
      drawSlider(mixCanvasRef.current, mix, 0, 100, '#303030', '#909090', enabled);
    }
  }, [mix, enabled]);

  // ── Engine helper ─────────────────────────────────────────────────────────────

  const setEngineParam = useCallback((cParamId: number, value: number) => {
    for (const r of session.regionsForTrack(track.stableId)) {
      session.getEngine().setPluginParam(r.engineSlot, DelayPlugin.pluginId, cParamId, value);
    }
  }, [session, track.stableId]);

  // ── Coordinate helper ─────────────────────────────────────────────────────────

  function canvasX(e: React.MouseEvent<HTMLCanvasElement> | MouseEvent, canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    return (e.clientX - rect.left) * (CW / rect.width);
  }

  // ── Division mode helper ──────────────────────────────────────────────────────

  const applyDivMode = useCallback((div: DivMode, currentBpm: number) => {
    const ms = divToMs(div, currentBpm);
    if (ms === null) return;
    setTimeMs(ms);
    setEngineParam(1 /* DELAY_PARAM_TIME_MS */, ms);
    session.execute(session.makeSetPluginParam(track.stableId, DelayPlugin, 'time_ms', ms));
  }, [session, track.stableId, setEngineParam]);

  // ── Time slider interaction ───────────────────────────────────────────────────

  const handleTimeDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    draggingTime.current = true;
    setDivMode('manual');
    const v = xToValue(canvasX(e, timeCanvasRef.current!), 1, 2000);
    setTimeMs(v);
    setEngineParam(1 /* DELAY_PARAM_TIME_MS */, v);
  }, [setEngineParam]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingTime.current || !timeCanvasRef.current) return;
      const v = xToValue(canvasX(e, timeCanvasRef.current), 1, 2000);
      setTimeMs(v);
      setEngineParam(1, v);
    }
    function onUp() {
      if (!draggingTime.current) return;
      draggingTime.current = false;
      session.execute(session.makeSetPluginParam(track.stableId, DelayPlugin, 'time_ms', timeMsRef.current));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [session, track.stableId, setEngineParam]);

  // ── Feedback slider interaction ───────────────────────────────────────────────

  const handleFeedbackDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    draggingFeedback.current = true;
    const v = xToValue(canvasX(e, feedbackCanvasRef.current!), 0, 95);
    setFeedback(v);
    setEngineParam(2 /* DELAY_PARAM_FEEDBACK */, v);
  }, [setEngineParam]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingFeedback.current || !feedbackCanvasRef.current) return;
      const v = xToValue(canvasX(e, feedbackCanvasRef.current), 0, 95);
      setFeedback(v);
      setEngineParam(2, v);
    }
    function onUp() {
      if (!draggingFeedback.current) return;
      draggingFeedback.current = false;
      session.execute(session.makeSetPluginParam(track.stableId, DelayPlugin, 'feedback', feedbackRef.current));
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
    setEngineParam(3 /* DELAY_PARAM_MIX */, v);
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
      session.execute(session.makeSetPluginParam(track.stableId, DelayPlugin, 'mix', mixRef.current));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [session, track.stableId, setEngineParam]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const DIV_LABELS: DivMode[] = ['1/4', '1/8', '1/16', 'manual'];

  return (
    <div className="delay-panel">
      <div className="dsp-module-header">
        {/* Note division pills + BPM */}
        <div className="delay-div-row">
          {DIV_LABELS.map((div) => (
            <button
              key={div}
              className={`delay-pill${divMode === div ? ' active' : ''}`}
              onClick={() => {
                setDivMode(div);
                applyDivMode(div, bpm);
              }}
            >
              {div}
            </button>
          ))}
          <span style={{ fontSize: '0.6rem', color: '#444', marginLeft: 2 }}>BPM</span>
          <input
            type="number"
            className="delay-bpm-input"
            min={40}
            max={300}
            value={bpm}
            onChange={(e) => {
              const next = Math.max(40, Math.min(300, Number(e.target.value)));
              setBpm(next);
              if (divMode !== 'manual') {
                applyDivMode(divMode, next);
              }
            }}
          />
        </div>
        {/* Bypass */}
        <button
          className={`btn-bypass${enabled ? ' active' : ''}`}
          onClick={() => {
            const next = enabled ? 0 : 1;
            setEnabled(!enabled);
            setEngineParam(0 /* DELAY_PARAM_ENABLED */, next);
            session.execute(session.makeSetPluginParam(track.stableId, DelayPlugin, 'enabled', next));
          }}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Time slider */}
      <div className="delay-row">
        <span className="delay-row-label">Time</span>
        <canvas
          ref={timeCanvasRef}
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleTimeDown}
          onDoubleClick={() => {
            setDivMode('manual');
            setTimeMs(250);
            setEngineParam(1, 250);
            session.execute(session.makeSetPluginParam(track.stableId, DelayPlugin, 'time_ms', 250));
          }}
        />
        <span className="delay-value">{Math.round(timeMs)} ms</span>
      </div>

      {/* Feedback slider */}
      <div className="delay-row">
        <span className="delay-row-label">Feedback</span>
        <canvas
          ref={feedbackCanvasRef}
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleFeedbackDown}
          onDoubleClick={() => {
            setFeedback(35);
            setEngineParam(2, 35);
            session.execute(session.makeSetPluginParam(track.stableId, DelayPlugin, 'feedback', 35));
          }}
        />
        <span className="delay-value">{Math.round(feedback)} %</span>
      </div>

      {/* Mix slider */}
      <div className="delay-row">
        <span className="delay-row-label">Mix</span>
        <canvas
          ref={mixCanvasRef}
          style={{ width: CW, height: CH, cursor: 'ew-resize' }}
          onMouseDown={handleMixDown}
          onDoubleClick={() => {
            setMix(50);
            setEngineParam(3, 50);
            session.execute(session.makeSetPluginParam(track.stableId, DelayPlugin, 'mix', 50));
          }}
        />
        <span className="delay-value">{Math.round(mix)} %</span>
      </div>
    </div>
  );
}
