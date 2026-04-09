import { useEffect, useRef } from 'react';
import type { RegionView, WaveformPeaks } from '../types.js';

interface Viewport {
  scrollX: number;
  pxPerFrame: number;
  trackHeight: number;
}

interface RegionBlockProps {
  region: RegionView;
  peaks: WaveformPeaks | undefined;
  viewport: Viewport;
  laneWidth: number;
  isSelected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onLeftTrimMouseDown: (e: React.MouseEvent) => void;
  onRightTrimMouseDown: (e: React.MouseEvent) => void;
}

/** A single audio clip positioned on the timeline with a waveform canvas. */
export function RegionBlock({
  region,
  peaks,
  viewport,
  laneWidth,
  isSelected,
  onMouseDown,
  onLeftTrimMouseDown,
  onRightTrimMouseDown,
}: RegionBlockProps) {
  const { scrollX, pxPerFrame, trackHeight } = viewport;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const left = (region.startFrame - scrollX) * pxPerFrame;
  const trimmedFrames = region.trimEndFrame - region.trimStartFrame;
  const fullWidth = Math.max(4, trimmedFrames * pxPerFrame);

  // Viewport clipping — only draw the slice that is actually visible in the lane.
  // This keeps canvas draw time O(laneWidth) rather than O(regionWidth),
  // which prevents main-thread hangs on long clips.
  const clipLeft = Math.max(0, -left);                            // px off-screen to the left
  const drawLeft = Math.max(0, left);                             // clamped left edge of the div
  const visibleWidth = Math.max(1, Math.min(fullWidth - clipLeft, laneWidth - drawLeft));
  // How many audio frames to skip at the visible left edge
  const frameOffset = clipLeft / pxPerFrame;

  // Trim handles should only appear when their respective edges are visible
  const leftEdgeVisible  = left >= 0;
  const rightEdgeVisible = left + fullWidth <= laneWidth;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth  = Math.max(1, Math.round(visibleWidth));
    const cssHeight = trackHeight;

    canvas.width  = cssWidth * dpr;
    canvas.height = cssHeight * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Background
    ctx.fillStyle = '#1e2a3a';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const mid = cssHeight / 2;
    // framesPerPixel is constant across the full region (1/pxPerFrame)
    const framesPerPixel = 1 / pxPerFrame;

    if (import.meta.env.DEV) performance.mark('canvas:draw-start');

    // Draw L channel in blue — each canvas pixel maps to the visible slice
    ctx.fillStyle = '#4080c0';
    for (let px = 0; px < cssWidth; px++) {
      const fStart = region.trimStartFrame + frameOffset + Math.floor(px * framesPerPixel);
      const fEnd   = region.trimStartFrame + frameOffset + Math.floor((px + 1) * framesPerPixel);
      const binStart = Math.floor(fStart / peaks.blockSize);
      const binEnd   = Math.min(Math.ceil(fEnd / peaks.blockSize), peaks.peaksL.length - 1);

      let peak = 0;
      for (let b = binStart; b <= binEnd; b++) {
        if (peaks.peaksL[b] > peak) peak = peaks.peaksL[b];
      }

      const halfH = peak * mid * 0.9;
      ctx.fillRect(px, mid - halfH, 1, halfH * 2);
    }

    // Draw R channel (overlaid on bottom half) if stereo
    if (peaks.peaksR) {
      for (let px = 0; px < cssWidth; px++) {
        const fStart = region.trimStartFrame + frameOffset + Math.floor(px * framesPerPixel);
        const fEnd   = region.trimStartFrame + frameOffset + Math.floor((px + 1) * framesPerPixel);
        const binStart = Math.floor(fStart / peaks.blockSize);
        const binEnd   = Math.min(Math.ceil(fEnd / peaks.blockSize), peaks.peaksR.length - 1);

        let peak = 0;
        for (let b = binStart; b <= binEnd; b++) {
          if (peaks.peaksR[b] > peak) peak = peaks.peaksR[b];
        }

        const halfH = peak * mid * 0.9;
        ctx.fillStyle = `rgba(80, 140, 200, 0.6)`;
        ctx.fillRect(px, mid, 1, halfH);
        ctx.fillRect(px, mid - halfH, 1, halfH);
      }
    }

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(cssWidth, mid);
    ctx.stroke();

    if (import.meta.env.DEV) {
      performance.mark('canvas:draw-end');
      performance.measure('canvas:draw', 'canvas:draw-start', 'canvas:draw-end');
    }
  }, [peaks, region.trimStartFrame, region.trimEndFrame, trackHeight, visibleWidth, frameOffset, pxPerFrame]);

  // Don't render at all if the region is entirely off-screen
  if (visibleWidth <= 0) return null;

  return (
    <div
      className={`region-block${isSelected ? ' region-block--selected' : ''}`}
      style={{
        position: 'absolute',
        left: drawLeft,
        top: 0,
        width: visibleWidth,
        height: trackHeight,
        cursor: 'grab',
        userSelect: 'none',
      }}
      onMouseDown={onMouseDown}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: visibleWidth, height: trackHeight, pointerEvents: 'none' }}
      />
      {/* Left trim handle — only when the actual audio start is visible */}
      {leftEdgeVisible && (
        <div
          className="region-trim-handle region-trim-handle--left"
          style={{
            position: 'absolute', left: 0, top: 0, width: 8, height: trackHeight,
            cursor: 'ew-resize',
          }}
          onMouseDown={(e) => { e.stopPropagation(); onLeftTrimMouseDown(e); }}
        />
      )}
      {/* Right trim handle — only when the actual audio end is visible */}
      {rightEdgeVisible && (
        <div
          className="region-trim-handle region-trim-handle--right"
          style={{
            position: 'absolute', right: 0, top: 0, width: 8, height: trackHeight,
            cursor: 'ew-resize',
          }}
          onMouseDown={(e) => { e.stopPropagation(); onRightTrimMouseDown(e); }}
        />
      )}
    </div>
  );
}
