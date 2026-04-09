// worklet.test.ts — unit tests for public/worklet.js logic.
// Uses the vm harness to run the real worklet code in Node with real WASM.
// Covers: init flow, command dispatch, process() output, seq correlation.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeProcessor } from './harness.js';
import type { ProcessorInstance } from './harness.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));

// ── Shared WASM module (compiled once, instantiated fresh per test) ──────────

let wasmMod: WebAssembly.Module;

beforeAll(async () => {
  const buf = readFileSync(path.join(__dir, '../../public/audio_engine.wasm'));
  wasmMod = await WebAssembly.compile(buf);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function initProcessor(): Promise<ProcessorInstance> {
  const proc = makeProcessor();
  const ready = proc.port.nextMessage('ready');
  proc.port.deliver({ type: 'init', wasmModule: wasmMod });
  await ready;
  return proc;
}

function makePCM(frames: number, value = 0.5): Float32Array {
  return new Float32Array(frames).fill(value);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('initialization', () => {
  it('sends ready after async WASM instantiation', async () => {
    const proc = makeProcessor();
    expect(proc.ready).toBe(false);

    const ready = proc.port.nextMessage('ready');
    proc.port.deliver({ type: 'init', wasmModule: wasmMod });

    await ready;
    expect(proc.ready).toBe(true);
    expect(proc.exports).not.toBeNull();
  });

  it('each processor gets an independent WASM instance', async () => {
    const a = await initProcessor();
    const b = await initProcessor();
    expect(a.exports).not.toBe(b.exports);
  });

  it('ignores cmd messages received before ready', () => {
    const proc = makeProcessor();
    // No WASM yet — _handleCmd should be a no-op
    expect(() =>
      proc.port.deliver({ type: 'cmd', fn: 'engine_set_gain', id: 0, value: 0.5 }),
    ).not.toThrow();
  });
});

describe('engine_add_track command', () => {
  it('copies PCM into WASM heap and returns a valid slot', async () => {
    const proc = await initProcessor();
    const pcmL = makePCM(1024, 0.5);

    const msg = proc.port.nextMessage('track_added');
    proc.port.deliver({
      type: 'cmd', fn: 'engine_add_track',
      pcmL, pcmR: null,
      numFrames: 1024, sampleRate: 44100,
      seq: 7,
    });

    const reply = await msg as { type: string; id: number; seq: number };
    expect(reply.type).toBe('track_added');
    expect(reply.id).toBeGreaterThanOrEqual(0);
    expect(reply.id).toBeLessThan(32);
  });

  it('echoes seq so concurrent addTrack calls can be correlated', async () => {
    const proc = await initProcessor();

    const msg1 = proc.port.nextMessage('track_added');
    proc.port.deliver({
      type: 'cmd', fn: 'engine_add_track',
      pcmL: makePCM(512), pcmR: null,
      numFrames: 512, sampleRate: 44100, seq: 42,
    });
    const r1 = await msg1 as { seq: number };
    expect(r1.seq).toBe(42);
  });
});

describe('mixer commands', () => {
  let proc: ProcessorInstance;

  beforeEach(async () => {
    proc = await initProcessor();
    // Add a track so slot 0 is active
    const added = proc.port.nextMessage('track_added');
    proc.port.deliver({
      type: 'cmd', fn: 'engine_add_track',
      pcmL: makePCM(44100), pcmR: null,
      numFrames: 44100, sampleRate: 44100, seq: 1,
    });
    await added;
  });

  it('engine_set_gain does not throw', () => {
    expect(() =>
      proc.port.deliver({ type: 'cmd', fn: 'engine_set_gain', id: 0, value: 0.5 }),
    ).not.toThrow();
  });

  it('engine_set_mute does not throw', () => {
    expect(() =>
      proc.port.deliver({ type: 'cmd', fn: 'engine_set_mute', id: 0, muted: true }),
    ).not.toThrow();
  });

  it('engine_set_pan does not throw', () => {
    expect(() =>
      proc.port.deliver({ type: 'cmd', fn: 'engine_set_pan', id: 0, value: -0.5 }),
    ).not.toThrow();
  });

  it('engine_plugin_set_param routes to WASM (EQ band gain)', () => {
    // pluginId 0 = PLUGIN_EQ, paramId 2 = EQ_PARAM_BAND0_GAIN
    expect(() =>
      proc.port.deliver({
        type: 'cmd', fn: 'engine_plugin_set_param',
        id: 0, pluginId: 0, paramId: 2, value: 6.0,
      }),
    ).not.toThrow();
  });
});

describe('process()', () => {
  it('returns true to keep the processor alive', async () => {
    const proc = await initProcessor();
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    expect(proc.process([], [[L, R]])).toBe(true);
  });

  it('outputs silence when engine is not playing', async () => {
    const proc = await initProcessor();
    const added = proc.port.nextMessage('track_added');
    proc.port.deliver({
      type: 'cmd', fn: 'engine_add_track',
      pcmL: makePCM(44100, 0.8), pcmR: null,
      numFrames: 44100, sampleRate: 44100, seq: 1,
    });
    await added;
    // Engine not playing — output should be silent
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    proc.process([], [[L, R]]);
    expect(L.every(x => x === 0)).toBe(true);
    expect(R.every(x => x === 0)).toBe(true);
  });

  it('outputs non-zero audio after play', async () => {
    const proc = await initProcessor();

    const added = proc.port.nextMessage('track_added');
    proc.port.deliver({
      type: 'cmd', fn: 'engine_add_track',
      pcmL: makePCM(44100, 0.5), pcmR: null,
      numFrames: 44100, sampleRate: 44100, seq: 1,
    });
    await added;

    proc.port.deliver({ type: 'cmd', fn: 'engine_play' });

    const L = new Float32Array(128);
    const R = new Float32Array(128);
    proc.process([], [[L, R]]);

    const rmsL = Math.sqrt(L.reduce((s, x) => s + x * x, 0) / L.length);
    expect(rmsL).toBeGreaterThan(0.01);
  });

  it('stereo: both L and R channels carry signal', async () => {
    const proc = await initProcessor();

    const added = proc.port.nextMessage('track_added');
    proc.port.deliver({
      type: 'cmd', fn: 'engine_add_track',
      pcmL: makePCM(44100, 0.5), pcmR: null,
      numFrames: 44100, sampleRate: 44100, seq: 1,
    });
    await added;

    proc.port.deliver({ type: 'cmd', fn: 'engine_play' });

    const L = new Float32Array(128);
    const R = new Float32Array(128);
    proc.process([], [[L, R]]);

    const rmsL = Math.sqrt(L.reduce((s, x) => s + x * x, 0) / L.length);
    const rmsR = Math.sqrt(R.reduce((s, x) => s + x * x, 0) / R.length);
    // Both channels must carry signal (catches the mono channel regression)
    expect(rmsL).toBeGreaterThan(0.01);
    expect(rmsR).toBeGreaterThan(0.01);
  });

  it('mute produces silence', async () => {
    const proc = await initProcessor();

    const added = proc.port.nextMessage('track_added');
    proc.port.deliver({
      type: 'cmd', fn: 'engine_add_track',
      pcmL: makePCM(44100, 0.5), pcmR: null,
      numFrames: 44100, sampleRate: 44100, seq: 1,
    });
    await added;

    proc.port.deliver({ type: 'cmd', fn: 'engine_play' });
    proc.port.deliver({ type: 'cmd', fn: 'engine_set_mute', id: 0, muted: true });

    const L = new Float32Array(128);
    const R = new Float32Array(128);
    proc.process([], [[L, R]]);

    const rmsL = Math.sqrt(L.reduce((s, x) => s + x * x, 0) / L.length);
    expect(rmsL).toBeLessThan(0.001);
  });
});
