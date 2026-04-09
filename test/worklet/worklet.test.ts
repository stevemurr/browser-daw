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

/**
 * Helper: add a track using the new chunked API.
 * 1. engine_add_track_chunked → awaits track_added_chunked (get slot)
 * 2. engine_load_chunk        → awaits chunk_loaded
 * Returns the assigned slot id.
 */
async function addTrackChunked(
  proc: ProcessorInstance,
  pcmL: Float32Array,
  pcmR: Float32Array | null,
  seq: number,
): Promise<number> {
  const numFrames = pcmL.length;

  // Step 1: allocate slot
  const chunkedMsg = proc.port.nextMessage('track_added_chunked');
  proc.port.deliver({
    type: 'cmd', fn: 'engine_add_track_chunked',
    numFrames, sampleRate: 44100,
    seq,
  });
  const reply = await chunkedMsg as { type: string; slot: number; seq: number };
  const slot = reply.slot;

  // Step 2: load initial chunk (full PCM for these tests — well within CHUNK_FRAMES)
  const loadedMsg = proc.port.nextMessage('chunk_loaded');
  proc.port.deliver({
    type: 'cmd', fn: 'engine_load_chunk',
    slot, chunkL: pcmL, chunkR: pcmR,
    chunkStart: 0, chunkLength: numFrames,
    seq: seq + 1000, // different seq to avoid collision
  });
  await loadedMsg;

  return slot;
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

describe('engine_add_track_chunked + engine_load_chunk commands', () => {
  it('add_track_chunked returns a valid slot, load_chunk confirms load', async () => {
    const proc = await initProcessor();
    const slot = await addTrackChunked(proc, makePCM(1024, 0.5), null, 7);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(32);
  });

  it('echoes seq so concurrent addTrack calls can be correlated', async () => {
    const proc = await initProcessor();

    const msg1 = proc.port.nextMessage('track_added_chunked');
    proc.port.deliver({
      type: 'cmd', fn: 'engine_add_track_chunked',
      numFrames: 512, sampleRate: 44100, seq: 42,
    });
    const r1 = await msg1 as { seq: number };
    expect(r1.seq).toBe(42);
  });
});

describe('mixer commands', () => {
  let proc: ProcessorInstance;
  let slot: number;

  beforeEach(async () => {
    proc = await initProcessor();
    slot = await addTrackChunked(proc, makePCM(44100), null, 1);
  });

  it('engine_set_gain does not throw', () => {
    expect(() =>
      proc.port.deliver({ type: 'cmd', fn: 'engine_set_gain', id: slot, value: 0.5 }),
    ).not.toThrow();
  });

  it('engine_set_mute does not throw', () => {
    expect(() =>
      proc.port.deliver({ type: 'cmd', fn: 'engine_set_mute', id: slot, muted: true }),
    ).not.toThrow();
  });

  it('engine_set_pan does not throw', () => {
    expect(() =>
      proc.port.deliver({ type: 'cmd', fn: 'engine_set_pan', id: slot, value: -0.5 }),
    ).not.toThrow();
  });

  it('engine_plugin_set_param routes to WASM (EQ band gain)', () => {
    // pluginId 0 = PLUGIN_EQ, paramId 2 = EQ_PARAM_BAND0_GAIN
    expect(() =>
      proc.port.deliver({
        type: 'cmd', fn: 'engine_plugin_set_param',
        id: slot, pluginId: 0, paramId: 2, value: 6.0,
      }),
    ).not.toThrow();
  });
});

describe('engine_set_start_frame command', () => {
  it('does not throw for a valid track slot', async () => {
    const proc = await initProcessor();
    const slot = await addTrackChunked(proc, makePCM(44100), null, 1);
    expect(() =>
      proc.port.deliver({ type: 'cmd', fn: 'engine_set_start_frame', id: slot, startFrame: 44100 }),
    ).not.toThrow();
  });

  it('delays audio output by the given frame count', async () => {
    const proc = await initProcessor();
    const slot = await addTrackChunked(proc, makePCM(44100, 0.5), null, 1);

    // start_frame=256 → first two 128-frame blocks must be silent
    proc.port.deliver({ type: 'cmd', fn: 'engine_set_start_frame', id: slot, startFrame: 256 });
    proc.port.deliver({ type: 'cmd', fn: 'engine_play' });

    const L1 = new Float32Array(128);
    const R1 = new Float32Array(128);
    proc.process([], [[L1, R1]]);

    const L2 = new Float32Array(128);
    const R2 = new Float32Array(128);
    proc.process([], [[L2, R2]]);

    expect(L1.every(x => x === 0)).toBe(true);
    expect(L2.every(x => x === 0)).toBe(true);

    // Third block (frames 256-383) has audio
    const L3 = new Float32Array(128);
    const R3 = new Float32Array(128);
    proc.process([], [[L3, R3]]);
    expect(L3.some(x => Math.abs(x) > 0.01)).toBe(true);
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
    await addTrackChunked(proc, makePCM(44100, 0.8), null, 1);
    // Engine not playing — output should be silent
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    proc.process([], [[L, R]]);
    expect(L.every(x => x === 0)).toBe(true);
    expect(R.every(x => x === 0)).toBe(true);
  });

  it('outputs non-zero audio after play', async () => {
    const proc = await initProcessor();
    await addTrackChunked(proc, makePCM(44100, 0.5), null, 1);

    proc.port.deliver({ type: 'cmd', fn: 'engine_play' });

    const L = new Float32Array(128);
    const R = new Float32Array(128);
    proc.process([], [[L, R]]);

    const rmsL = Math.sqrt(L.reduce((s, x) => s + x * x, 0) / L.length);
    expect(rmsL).toBeGreaterThan(0.01);
  });

  it('stereo: both L and R channels carry signal', async () => {
    const proc = await initProcessor();
    await addTrackChunked(proc, makePCM(44100, 0.5), null, 1);

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
    const slot = await addTrackChunked(proc, makePCM(44100, 0.5), null, 1);

    proc.port.deliver({ type: 'cmd', fn: 'engine_play' });
    proc.port.deliver({ type: 'cmd', fn: 'engine_set_mute', id: slot, muted: true });

    const L = new Float32Array(128);
    const R = new Float32Array(128);
    proc.process([], [[L, R]]);

    const rmsL = Math.sqrt(L.reduce((s, x) => s + x * x, 0) / L.length);
    expect(rmsL).toBeLessThan(0.001);
  });
});
