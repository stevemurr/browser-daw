// rulerAdapter.test.ts — unit tests for TimeRulerAdapter and BarRulerAdapter.
// Pure logic tests; no Session, WASM, or DOM required.

import { describe, it, expect } from 'vitest';
import {
  TimeRulerAdapter,
  BarRulerAdapter,
} from '../src/components/RulerAdapter.js';

const SR = 44100;  // sample rate used throughout

// ── BarRulerAdapter ───────────────────────────────────────────────────────────

describe('BarRulerAdapter', () => {
  const BPM = 120;
  // framesPerBeat = 44100 * 60 / 120 = 22050
  // framesPerBar  = 22050 * 4 = 88200
  const adapter = new BarRulerAdapter(BPM, '1/4', SR);

  it('framesPerBar at 120 BPM is 88200', () => {
    // Verify by checking that bar 2 major tick is at frame 88200
    const ticks = adapter.ticks(0, 0.005, 4000);
    const majorFrames = ticks.filter(t => t.isMajor).map(t => t.frame);
    expect(majorFrames).toContain(88200);
  });

  it('bar 1 major tick is at frame 0', () => {
    const ticks = adapter.ticks(0, 0.005, 4000);
    const firstMajor = ticks.find(t => t.isMajor);
    expect(firstMajor?.frame).toBe(0);
  });

  it('major ticks have numeric bar labels starting at 1', () => {
    const ticks = adapter.ticks(0, 0.005, 10000);
    const major = ticks.filter(t => t.isMajor);
    expect(major[0]?.label).toBe('1');
    expect(major[1]?.label).toBe('2');
    expect(major[2]?.label).toBe('3');
  });

  it('minor ticks between bars have no label', () => {
    const ticks = adapter.ticks(0, 0.005, 10000);
    const minor = ticks.filter(t => !t.isMajor);
    expect(minor.length).toBeGreaterThan(0);
    for (const t of minor) {
      expect(t.label).toBeUndefined();
    }
  });

  it('frameToLabel(0) returns "1.1" (bar 1, beat 1)', () => {
    expect(adapter.frameToLabel(0)).toBe('1.1');
  });

  it('frameToLabel(22050) returns "1.2" (bar 1, beat 2 at 120 BPM)', () => {
    expect(adapter.frameToLabel(22050)).toBe('1.2');
  });

  it('frameToLabel(88200) returns "2.1" (bar 2, beat 1)', () => {
    expect(adapter.frameToLabel(88200)).toBe('2.1');
  });

  it('subdivision 1/8 produces more minor ticks than 1/4 for same viewport', () => {
    const adapter4  = new BarRulerAdapter(120, '1/4',  SR);
    const adapter8  = new BarRulerAdapter(120, '1/8',  SR);
    const ticks4 = adapter4.ticks(0, 0.005, 2000).filter(t => !t.isMajor);
    const ticks8 = adapter8.ticks(0, 0.005, 2000).filter(t => !t.isMajor);
    expect(ticks8.length).toBeGreaterThan(ticks4.length);
  });

  it('subdivision 1/16 produces more minor ticks than 1/8 for same viewport', () => {
    const adapter8  = new BarRulerAdapter(120, '1/8',  SR);
    const adapter16 = new BarRulerAdapter(120, '1/16', SR);
    const ticks8  = adapter8.ticks(0, 0.005, 2000).filter(t => !t.isMajor);
    const ticks16 = adapter16.ticks(0, 0.005, 2000).filter(t => !t.isMajor);
    expect(ticks16.length).toBeGreaterThan(ticks8.length);
  });

  it('no ticks are returned when viewport is off-screen', () => {
    // scrollX is far beyond width of visible area
    const ticks = adapter.ticks(0, 0.005, 0);
    expect(ticks.length).toBe(0);
  });

  it('different BPM produces different bar widths', () => {
    const slow = new BarRulerAdapter(60,  '1/4', SR);
    const fast = new BarRulerAdapter(240, '1/4', SR);
    const slowMajors = slow.ticks(0, 0.005, 3000).filter(t => t.isMajor).map(t => t.frame);
    const fastMajors = fast.ticks(0, 0.005, 3000).filter(t => t.isMajor).map(t => t.frame);
    // At 60 BPM bars are wider (fewer fit); at 240 BPM bars are narrower (more fit)
    expect(fastMajors.length).toBeGreaterThan(slowMajors.length);
  });
});

// ── TimeRulerAdapter ──────────────────────────────────────────────────────────

describe('TimeRulerAdapter', () => {
  const adapter = new TimeRulerAdapter(SR);

  it('major ticks have "Xs" or "M:SS" format labels', () => {
    const ticks = adapter.ticks(0, 0.005, 2000);
    const major = ticks.filter(t => t.isMajor && t.label);
    expect(major.length).toBeGreaterThan(0);
    for (const t of major) {
      expect(t.label).toMatch(/^(\d+:\d{2}|\d+\.?\d*s)$/);
    }
  });

  it('produces fewer total ticks when zoomed in (fewer frames fit in viewport)', () => {
    // At 0.1 px/frame: viewport covers 20 000 frames; at 0.005 it covers 400 000 frames.
    // Zoomed-in viewport covers far fewer frames, so fewer ticks are drawn.
    const zoomed = adapter.ticks(0, 0.1,  2000);
    const normal = adapter.ticks(0, 0.005, 2000);
    expect(zoomed.length).toBeLessThan(normal.length);
  });

  it('frameToLabel(0) returns "00:00"', () => {
    expect(adapter.frameToLabel(0)).toBe('00:00');
  });

  it('frameToLabel(44100) returns "00:01"', () => {
    expect(adapter.frameToLabel(44100)).toBe('00:01');
  });

  it('frameToLabel(44100 * 65) returns "01:05" (1 min 5 sec)', () => {
    expect(adapter.frameToLabel(44100 * 65)).toBe('01:05');
  });

  it('minor ticks have no label', () => {
    const ticks = adapter.ticks(0, 0.005, 2000);
    const minor = ticks.filter(t => !t.isMajor);
    expect(minor.length).toBeGreaterThan(0);
    for (const t of minor) {
      expect(t.label).toBeUndefined();
    }
  });
});
