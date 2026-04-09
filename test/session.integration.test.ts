// Session → AudioEngine → SimulatedWorklet → real WASM integration tests.
// Tests run headless in Node; no browser or AudioContext needed.

import { describe, it, expect, beforeEach } from 'vitest';
import { SimulatedWorklet } from './harness/SimulatedWorklet.js';
import { AudioEngine } from '../src/AudioEngine.js';
import { Session } from '../src/Session.js';
import { EQPlugin } from '../src/plugins/eq.plugin.js';

// Helpers ─────────────────────────────────────────────────────────────────────

function silentPCM(frames: number): Float32Array {
  return new Float32Array(frames);
}

function tonePCM(frames: number, value = 0.5): Float32Array {
  return new Float32Array(frames).fill(value);
}

async function makeSession(): Promise<{ session: Session; worklet: SimulatedWorklet }> {
  const worklet = new SimulatedWorklet();
  await worklet.ready_();
  const engine = new AudioEngine(worklet);
  worklet.postMessage({ type: 'init' });
  await new Promise<void>((r) => setTimeout(r, 10));
  const session = new Session(engine);
  return { session, worklet };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Session ↔ AudioEngine ↔ WASM', () => {

  describe('AddTrack', () => {
    it('adds a track and registers it in the mirror', async () => {
      const { session } = await makeSession();

      const pcmL = tonePCM(1024);
      await session.execute(session.makeAddTrack(pcmL, null, 1024, 44100, 'Track 1'));

      const state = session.getState();
      expect(state.tracks.size).toBe(1);
      const track = [...state.tracks.values()][0];
      expect(track.name).toBe('Track 1');
      expect(track.gain).toBe(1.0);
      expect(track.engineSlot).toBeGreaterThanOrEqual(0);
      expect(track.engineSlot).toBeLessThan(32);
    });

    it('initialises plugin state with defaults for all registered plugins', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));

      const track = [...session.getState().tracks.values()][0];
      expect(track.plugins).toBeDefined();
      expect(track.plugins['eq']).toBeDefined();
      expect(track.plugins['eq']['enabled']).toBe(1);
      expect(track.plugins['eq']['band0_freq']).toBe(80);
      expect(track.plugins['eq']['band1_gain']).toBe(0);
    });

    it('assigns distinct engine slots to two tracks', async () => {
      const { session } = await makeSession();

      await session.execute(session.makeAddTrack(tonePCM(512), null, 512, 44100, 'A'));
      await session.execute(session.makeAddTrack(tonePCM(512), null, 512, 44100, 'B'));

      const slots = [...session.getState().tracks.values()].map((t) => t.engineSlot);
      expect(slots[0]).not.toBe(slots[1]);
    });

    it('seq correlation: concurrent addTrack calls resolve to correct slots', async () => {
      const { session } = await makeSession();

      const p1 = session.execute(session.makeAddTrack(tonePCM(256), null, 256, 44100, 'X'));
      const p2 = session.execute(session.makeAddTrack(tonePCM(256), null, 256, 44100, 'Y'));
      await Promise.all([p1, p2]);

      const tracks = [...session.getState().tracks.values()];
      expect(tracks).toHaveLength(2);
      const names = new Set(tracks.map((t) => t.name));
      expect(names).toContain('X');
      expect(names).toContain('Y');
      expect(tracks[0].engineSlot).not.toBe(tracks[1].engineSlot);
    });
  });

  describe('Undo / Redo', () => {
    it('canUndo is false initially, true after execute', async () => {
      const { session } = await makeSession();
      expect(session.getState().canUndo).toBe(false);
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));
      expect(session.getState().canUndo).toBe(true);
    });

    it('undo AddTrack removes track from mirror', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));
      expect(session.getState().tracks.size).toBe(1);

      await session.undo();
      expect(session.getState().tracks.size).toBe(0);
      expect(session.getState().canUndo).toBe(false);
      expect(session.getState().canRedo).toBe(true);
    });

    it('redo AddTrack re-adds track with same stableId', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));

      const stableIdBefore = [...session.getState().tracks.keys()][0];

      await session.undo();
      await session.redo();

      const stableIdAfter = [...session.getState().tracks.keys()][0];
      expect(stableIdAfter).toBe(stableIdBefore);
    });

    it('execute after undo clears redo stack', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));
      await session.undo();
      expect(session.getState().canRedo).toBe(true);

      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'U'));
      expect(session.getState().canRedo).toBe(false);
    });

    it('undo/redo SetGain restores correct value in mirror', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];

      await session.execute(session.makeSetGain(id, 1.5));
      expect(session.getState().tracks.get(id)!.gain).toBe(1.5);

      await session.undo();
      expect(session.getState().tracks.get(id)!.gain).toBe(1.0);

      await session.redo();
      expect(session.getState().tracks.get(id)!.gain).toBe(1.5);
    });

    it('undo SetGain reverts label', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];
      await session.execute(session.makeSetGain(id, 1.8));

      expect(session.getState().undoLabel).toBe('Set Gain');
      await session.undo();
      expect(session.getState().undoLabel).toBe('Add Track');
    });

    it('undo RemoveTrack re-adds track and restores params', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(tonePCM(512), null, 512, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];

      await session.execute(session.makeSetGain(id, 1.7));
      await session.execute(session.makeSetMute(id, true));
      await session.execute(session.makeRemoveTrack(id));

      expect(session.getState().tracks.size).toBe(0);
      await session.undo();

      const t = session.getState().tracks.get(id)!;
      expect(t).toBeDefined();
      expect(t.gain).toBe(1.7);
      expect(t.muted).toBe(true);
    });
  });

  describe('Plugin param commands (EQ)', () => {
    it('makeSetPluginParam updates mirror value', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];

      await session.execute(session.makeSetPluginParam(id, EQPlugin, 'band0_gain', 6.0));

      expect(session.getState().tracks.get(id)!.plugins['eq']['band0_gain']).toBe(6.0);
    });

    it('undo SetPluginParam restores previous value', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];

      await session.execute(session.makeSetPluginParam(id, EQPlugin, 'band0_gain', 6.0));
      await session.undo();

      expect(session.getState().tracks.get(id)!.plugins['eq']['band0_gain']).toBe(0); // default
    });

    it('redo SetPluginParam re-applies value', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];

      await session.execute(session.makeSetPluginParam(id, EQPlugin, 'band1_freq', 2000));
      await session.undo();
      await session.redo();

      expect(session.getState().tracks.get(id)!.plugins['eq']['band1_freq']).toBe(2000);
    });

    it('SetPluginParam command description includes plugin and param label', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];

      await session.execute(session.makeSetPluginParam(id, EQPlugin, 'band0_gain', 3.0));
      expect(session.getState().undoLabel).toBe('Set eq.Low Shelf Gain');
    });

    it('throws on unknown param id', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];

      expect(() => session.makeSetPluginParam(id, EQPlugin, 'bad_param', 1)).toThrow();
    });

    it('undo RemoveTrack restores EQ plugin params generically', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(tonePCM(512), null, 512, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];

      // Boost a mid band
      await session.execute(session.makeSetPluginParam(id, EQPlugin, 'band1_gain', 9.0));
      await session.execute(session.makeRemoveTrack(id));

      expect(session.getState().tracks.size).toBe(0);
      await session.undo();

      const t = session.getState().tracks.get(id)!;
      expect(t.plugins['eq']['band1_gain']).toBe(9.0);
    });
  });

  describe('WASM output via SimulatedWorklet.processBlock()', () => {
    it('silent PCM track produces silent output', async () => {
      const { session, worklet } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(1024), null, 1024, 44100, 'T'));
      worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
      await new Promise((r) => setTimeout(r, 5));

      const { L, R } = worklet.processBlock();
      expect(L.every((v) => Math.abs(v) < 1e-7)).toBe(true);
      expect(R.every((v) => Math.abs(v) < 1e-7)).toBe(true);
    });

    it('0.5 PCM track produces expected output through full chain', async () => {
      const { session, worklet } = await makeSession();
      await session.execute(session.makeAddTrack(tonePCM(1024, 0.5), null, 1024, 44100, 'T'));
      worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
      await new Promise((r) => setTimeout(r, 5));

      const { L } = worklet.processBlock();
      // tanh(0.5 * cos(π/4)) ≈ 0.3395
      expect(Math.abs(L[0] - 0.3395)).toBeLessThan(0.001);
    });

    it('muting a track via Session silences WASM output', async () => {
      const { session, worklet } = await makeSession();
      await session.execute(session.makeAddTrack(tonePCM(1024, 0.5), null, 1024, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];
      await session.execute(session.makeSetMute(id, true));

      worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
      await new Promise((r) => setTimeout(r, 5));

      const { L } = worklet.processBlock();
      expect(L.every((v) => Math.abs(v) < 1e-7)).toBe(true);
    });

    it('undo SetMute restores audible output', async () => {
      const { session, worklet } = await makeSession();
      await session.execute(session.makeAddTrack(tonePCM(1024, 0.5), null, 1024, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];
      await session.execute(session.makeSetMute(id, true));

      worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
      await new Promise((r) => setTimeout(r, 5));

      worklet.postMessage({ type: 'cmd', fn: 'engine_seek', position: 0 });
      await new Promise((r) => setTimeout(r, 5));
      const { L: mutedL } = worklet.processBlock();
      expect(mutedL.every((v) => Math.abs(v) < 1e-7)).toBe(true);

      await session.undo();
      worklet.postMessage({ type: 'cmd', fn: 'engine_seek', position: 0 });
      await new Promise((r) => setTimeout(r, 5));
      const { L: unmutedL } = worklet.processBlock();
      expect(unmutedL.some((v) => Math.abs(v) > 0.1)).toBe(true);
    });

    it('EQ gain boost via plugin command changes WASM output', async () => {
      const { session, worklet } = await makeSession();
      // Use a non-trivial signal so EQ has something to act on
      await session.execute(session.makeAddTrack(tonePCM(1024, 0.1), null, 1024, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];

      worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
      await new Promise((r) => setTimeout(r, 5));

      // Flat EQ baseline
      worklet.postMessage({ type: 'cmd', fn: 'engine_seek', position: 0 });
      await new Promise((r) => setTimeout(r, 5));
      const { L: flat } = worklet.processBlock();

      // Boost mid band by +18 dB — output must differ from flat
      await session.execute(session.makeSetPluginParam(id, EQPlugin, 'band1_gain', 18));
      worklet.postMessage({ type: 'cmd', fn: 'engine_seek', position: 0 });
      await new Promise((r) => setTimeout(r, 5));
      const { L: boosted } = worklet.processBlock();

      const flatMag    = flat.reduce((s, v) => s + Math.abs(v), 0);
      const boostedMag = boosted.reduce((s, v) => s + Math.abs(v), 0);
      expect(boostedMag).toBeGreaterThan(flatMag * 1.1); // at least 10% louder
    });
  });

  describe('Continuous controls', () => {
    it('commitContinuous pushes exactly one undo entry', async () => {
      const { session } = await makeSession();
      await session.execute(session.makeAddTrack(silentPCM(256), null, 256, 44100, 'T'));
      const id = [...session.getState().tracks.keys()][0];

      session.beginContinuous(session.makeSetGain(id, 1.0));

      session.getEngine().setGain(session.slotFor(id), 1.2);
      session.getEngine().setGain(session.slotFor(id), 1.4);

      await session.commitContinuous(session.makeSetGain(id, 1.4));

      expect(session.getState().undoLabel).toBe('Set Gain');
      expect(session.getState().tracks.get(id)!.gain).toBe(1.4);

      await session.undo();
      expect(session.getState().tracks.get(id)!.gain).toBe(1.0);
      expect(session.getState().canUndo).toBe(true);
    });
  });

  describe('Master gain', () => {
    it('undo/redo SetMasterGain', async () => {
      const { session } = await makeSession();
      expect(session.getState().masterGain).toBe(1.0);

      await session.execute(session.makeSetMasterGain(0.5));
      expect(session.getState().masterGain).toBe(0.5);

      await session.undo();
      expect(session.getState().masterGain).toBe(1.0);

      await session.redo();
      expect(session.getState().masterGain).toBe(0.5);
    });
  });
});
