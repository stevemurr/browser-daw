import { useEffect, useRef } from 'react';

interface RulerProps {
  scrollX: number;    // leftmost visible frame
  pxPerFrame: number;
  width: number;      // canvas width in CSS px
  sampleRate: number;
}

/** Canvas time ruler — ticks adapt density to zoom level. */
export function Ruler({ scrollX, pxPerFrame, width, sampleRate }: RulerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = 30 * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, 30);

    // Choose tick interval: target ~80px between major ticks
    const pxPerSecond = pxPerFrame * sampleRate;
    const intervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
    const interval = intervals.find(s => s * pxPerSecond >= 80) ?? 300;
    const framesPerInterval = interval * sampleRate;

    // Minor ticks every 1/5 of major interval
    const minorFrames = framesPerInterval / 5;

    const firstMajor = Math.floor(scrollX / framesPerInterval) * framesPerInterval;

    ctx.strokeStyle = '#555';
    ctx.fillStyle = '#888';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    for (let frame = firstMajor; frame < scrollX + width / pxPerFrame; frame += minorFrames) {
      const x = (frame - scrollX) * pxPerFrame;
      if (x < -4 || x > width + 4) continue;

      const isMajor = Math.abs(frame % framesPerInterval) < 0.5;

      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 10 : 20);
      ctx.lineTo(x, 30);
      ctx.strokeStyle = isMajor ? '#666' : '#333';
      ctx.stroke();

      if (isMajor) {
        const secs = frame / sampleRate;
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        const label = mins > 0
          ? `${mins}:${String(Math.round(s)).padStart(2, '0')}`
          : `${s.toFixed(interval < 1 ? 1 : 0)}s`;
        ctx.fillStyle = '#888';
        ctx.fillText(label, x, 8);
      }
    }
  }, [scrollX, pxPerFrame, width, sampleRate]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width, height: 30, flexShrink: 0 }}
    />
  );
}
