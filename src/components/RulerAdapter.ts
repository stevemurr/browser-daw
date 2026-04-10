// RulerAdapter.ts — pluggable ruler tick strategy for the arrange view ruler.

export interface RulerTick {
  frame: number;
  isMajor: boolean;
  label?: string;  // only defined on major ticks
}

export interface RulerAdapter {
  /** Returns all ticks visible in the current viewport. */
  ticks(scrollX: number, pxPerFrame: number, width: number): RulerTick[];
  /** Converts a playhead frame position to a human-readable string. */
  frameToLabel(frame: number): string;
}

// ── TimeRulerAdapter ──────────────────────────────────────────────────────────

/** Displays time in seconds / MM:SS — mirrors the original Ruler.tsx logic. */
export class TimeRulerAdapter implements RulerAdapter {
  constructor(private readonly sampleRate: number) {}

  ticks(scrollX: number, pxPerFrame: number, width: number): RulerTick[] {
    const pxPerSecond = pxPerFrame * this.sampleRate;
    const intervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
    const interval = intervals.find(s => s * pxPerSecond >= 80) ?? 300;
    const framesPerInterval = interval * this.sampleRate;
    const minorFrames = framesPerInterval / 5;

    const firstMajor = Math.floor(scrollX / framesPerInterval) * framesPerInterval;
    const result: RulerTick[] = [];

    for (
      let frame = firstMajor;
      frame < scrollX + width / pxPerFrame;
      frame += minorFrames
    ) {
      const x = (frame - scrollX) * pxPerFrame;
      if (x < -4 || x > width + 4) continue;

      const isMajor = Math.abs(frame % framesPerInterval) < 0.5;
      const tick: RulerTick = { frame, isMajor };

      if (isMajor) {
        const secs = frame / this.sampleRate;
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        tick.label = mins > 0
          ? `${mins}:${String(Math.round(s)).padStart(2, '0')}`
          : `${s.toFixed(interval < 1 ? 1 : 0)}s`;
      }

      result.push(tick);
    }

    return result;
  }

  frameToLabel(frame: number): string {
    const secs = Math.floor(frame / this.sampleRate);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }
}

// ── BarRulerAdapter ───────────────────────────────────────────────────────────

export type Subdivision = '1/4' | '1/8' | '1/16';

/** Displays musical bars and beats based on BPM (assumes 4/4 time). */
export class BarRulerAdapter implements RulerAdapter {
  private readonly framesPerBeat: number;
  private readonly framesPerBar: number;
  private readonly minorDivisions: number;

  constructor(
    private readonly bpm: number,
    private readonly subdivision: Subdivision,
    private readonly sampleRate: number,
  ) {
    this.framesPerBeat = (sampleRate * 60) / bpm;
    this.framesPerBar  = this.framesPerBeat * 4;  // 4/4

    // How many minor tick divisions per beat
    this.minorDivisions = subdivision === '1/4' ? 1
      : subdivision === '1/8' ? 2
      : 4;  // 1/16
  }

  /** Frames per minor tick (subdivisions within a beat). */
  private get framesPerMinor(): number {
    return this.framesPerBeat / this.minorDivisions;
  }

  ticks(scrollX: number, pxPerFrame: number, width: number): RulerTick[] {
    const framesPerMinor = this.framesPerMinor;
    const firstMinor = Math.floor(scrollX / framesPerMinor) * framesPerMinor;
    const result: RulerTick[] = [];

    for (
      let frame = firstMinor;
      frame < scrollX + width / pxPerFrame;
      frame += framesPerMinor
    ) {
      const x = (frame - scrollX) * pxPerFrame;
      if (x < -4 || x > width + 4) continue;

      // A tick is a bar boundary if it's (approximately) a multiple of framesPerBar
      const isBar = Math.abs(frame % this.framesPerBar) < 0.5;
      const tick: RulerTick = { frame, isMajor: isBar };

      if (isBar) {
        const barNumber = Math.round(frame / this.framesPerBar) + 1;
        tick.label = String(barNumber);
      }

      result.push(tick);
    }

    return result;
  }

  frameToLabel(frame: number): string {
    const totalBeats = frame / this.framesPerBeat;
    const bar  = Math.floor(totalBeats / 4) + 1;    // 1-indexed
    const beat = Math.floor(totalBeats % 4) + 1;    // 1-indexed, 1–4
    return `${bar}.${beat}`;
  }
}
