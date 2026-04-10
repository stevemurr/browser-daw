import { useEffect, useRef } from 'react';
import type { RulerAdapter } from './RulerAdapter.js';

interface RulerProps {
  scrollX: number;      // leftmost visible frame
  pxPerFrame: number;
  width: number;        // canvas width in CSS px
  adapter: RulerAdapter;
}

/** Canvas ruler — delegates tick strategy to the provided RulerAdapter. */
export function Ruler({ scrollX, pxPerFrame, width, adapter }: RulerProps) {
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

    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    const ticks = adapter.ticks(scrollX, pxPerFrame, width);

    for (const tick of ticks) {
      const x = (tick.frame - scrollX) * pxPerFrame;

      ctx.beginPath();
      ctx.moveTo(x, tick.isMajor ? 10 : 20);
      ctx.lineTo(x, 30);
      ctx.strokeStyle = tick.isMajor ? '#666' : '#333';
      ctx.stroke();

      if (tick.isMajor && tick.label) {
        ctx.fillStyle = '#888';
        ctx.fillText(tick.label, x, 8);
      }
    }
  }, [scrollX, pxPerFrame, width, adapter]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width, height: 30, flexShrink: 0 }}
    />
  );
}
