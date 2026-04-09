// Session → AudioEngine → SimulatedWorklet → real WASM integration tests.
// Tests run headless in Node; no browser or AudioContext needed.

import { describe, it, expect } from 'vitest';
import { SimulatedWorklet } from './harness/SimulatedWorklet.js';
import { AudioEngine } from '../src/AudioEngine.js';
import { Session } from '../src/Session.js';
import { ChunkCacheManager } from '../src/ChunkCacheManager.js';
import type { AudioFileStore, AudioFileMeta } from '../src/store/AudioFileStore.js';
import type { WaveformPeaks } from '../src/types.js';
import { EQPlugin } from '../src/plugins/eq.plugin.js';

// ── MockAudioFileStore ────────────────────────────────────────────────────────
// In-memory store for Node test environment (no OPFS / IndexedDB available).

class MockAudioFileStore implements AudioFileStore {
  private pcm   = new Map<string, { L: Float32Array; R: Float32Array | null }>();
  private meta  = new Map<string, AudioFileMeta>();
  private peaks = new Map<string, WaveformPeaks>();

  async store(fileId: string, L: Float32Array, R: Float32Array | null, m: AudioFileMeta): Promise<void> {
    this.pcm.set(fileId, { L, R });
    this.meta.set(fileId, m);
  }

  async loadChunk(fileId: string, startFrame: number, length: number): Promise<{ chunkL: Float32Array; chunkR: Float32Array | null }> {
    const data = this.pcm.get(fileId);
    if (!data) return { chunkL: new Float32Array(length), chunkR: null };
    const end   = Math.min(startFrame + length, data.L.length);
    const chunkL = data.L.slice(startFrame, end);
    const chunkR = data.R ? data.R.slice(startFrame, end) : null;
    // Pad to requested length if file is shorter
    if (chunkL.length < length) {
      const padded = new Float32Array(length); padded.set(chunkL); return { chunkL: padded, chunkR };
    }
    return { chunkL, chunkR };
  }

  async storePeaks(fileId: string, p: WaveformPeaks): Promise<void> { this.peaks.set(fileId, p); }
  async loadPeaks(fileId: string): Promise<WaveformPeaks | null>    { return this.peaks.get(fileId) ?? null; }
  async delete(fileId: string): Promise<void> { this.pcm.delete(fileId); this.meta.delete(fileId); this.peaks.delete(fileId); }
  async listFiles(): Promise<AudioFileMeta[]> { return [...this.meta.values()]; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function silentPCM(frames: number): Float32Array { return new Float32Array(frames); }
function tonePCM(frames: number, value = 0.5): Float32Array { return new Float32Array(frames).fill(value); }

async function makeSession(): Promise<{ session: Session; worklet: SimulatedWorklet; store: MockAudioFileStore }> {
  const worklet = new SimulatedWorklet();
  await worklet.ready_();
  const engine  = new AudioEngine(worklet);
  worklet.postMessage({ type: 'init' });
  await new Promise<void>((r) => setTimeout(r, 10));
  const store   = new MockAudioFileStore();
  const chunks  = new ChunkCacheManager(engine, store);
  const session = new Session(engine, store, chunks);
  return { session, worklet, store };
}

/**
 * Convenience helper: store PCM in the mock store then execute AddTrack.
 * Mirrors what ArrangeView.handleDrop does in production.
 */
async function addTrack(
  session: Session,
  store: MockAudioFileStore,
  pcmL: Float32Array,
  pcmR: Float32Array | null,
  name: string,
  startFrame?: number,
): Promise<void> {
  const fileId = crypto.randomUUID();
  await store.store(fileId, pcmL, pcmR, {
    fileId, name, numFrames: pcmL.length, sampleRate: 44100, numChannels: pcmR ? 2 : 1,
  });
  await session.execute(session.makeAddTrack(fileId, name, pcmL.length, 44100, undefined, startFrame));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Session ↔ AudioEngine ↔ WASM', () => {

  describe('AddTrack', () => {
    it('adds a track and registers it in the mirror', async () => {
      const { session, store } = await makeSession();

      await addTrack(session, store, tonePCM(1024), null, 'Track 1');

      const state = session.getState();
      expect(state.tracks.size).toBe(1);
      const track = [...state.tracks.values()][0];
      expect(track.name).toBe('Track 1');
      expect(track.gain).toBe(1.0);
      // engineSlot now lives on the region, not the track
      const region = [...state.arrange.regions.values()][0];
      expect(region.engineSlot).toBeGreaterThanOrEqual(0);
      expect(region.engineSlot).toBeLessThan(32);
    });

    it('initialises plugin state with defaults for all registered plugins', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');

      const track = [...session.getState().tracks.values()][0];
      expect(track.plugins).toBeDefined();
      expect(track.plugins['eq']).toBeDefined();
      expect(track.plugins['eq']['enabled']).toBe(1);
      expect(track.plugins['eq']['band0_freq']).toBe(80);
      expect(track.plugins['eq']['band1_gain']).toBe(0);
    });

    it('assigns distinct engine slots to two tracks', async () => {
      const { session, store } = await makeSession();

      await addTrack(session, store, tonePCM(512), null, 'A');
      await addTrack(session, store, tonePCM(512), null, 'B');

      const slots = [...session.getState().arrange.regions.values()].map((r) => r.engineSlot);
      expect(slots[0]).not.toBe(slots[1]);
    });

    it('seq correlation: concurrent addTrack calls resolve to correct slots', async () => {
      const { session, store } = await makeSession();

      // Pre-store both PCMs so concurrent makeAddTrack calls have their data ready
      const fid1 = crypto.randomUUID();
      const fid2 = crypto.randomUUID();
      await store.store(fid1, tonePCM(256), null, { fileId: fid1, name: 'X', numFrames: 256, sampleRate: 44100, numChannels: 1 });
      await store.store(fid2, tonePCM(256), null, { fileId: fid2, name: 'Y', numFrames: 256, sampleRate: 44100, numChannels: 1 });
      const p1 = session.execute(session.makeAddTrack(fid1, 'X', 256, 44100));
      const p2 = session.execute(session.makeAddTrack(fid2, 'Y', 256, 44100));
      await Promise.all([p1, p2]);

      const tracks = [...session.getState().tracks.values()];
      expect(tracks).toHaveLength(2);
      const names = new Set(tracks.map((t) => t.name));
      expect(names).toContain('X');
      expect(names).toContain('Y');
      const regions = [...session.getState().arrange.regions.values()];
      expect(regions[0].engineSlot).not.toBe(regions[1].engineSlot);
    });
  });

  describe('Undo / Redo', () => {
    it('canUndo is false initially, true after execute', async () => {
      const { session, store } = await makeSession();
      expect(session.getState().canUndo).toBe(false);
      await addTrack(session, store, silentPCM(256), null, 'T');
      expect(session.getState().canUndo).toBe(true);
    });

    it('undo AddTrack removes track from mirror', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');
      expect(session.getState().tracks.size).toBe(1);

      await session.undo();
      expect(session.getState().tracks.size).toBe(0);
      expect(session.getState().canUndo).toBe(false);
      expect(session.getState().canRedo).toBe(true);
    });

    it('redo AddTrack re-adds track with same stableId', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');

      const stableIdBefore = [...session.getState().tracks.keys()][0];

      await session.undo();
      await session.redo();

      const stableIdAfter = [...session.getState().tracks.keys()][0];
      expect(stableIdAfter).toBe(stableIdBefore);
    });

    it('execute after undo clears redo stack', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');
      await session.undo();
      expect(session.getState().canRedo).toBe(true);

      await addTrack(session, store, silentPCM(256), null, 'U');
      expect(session.getState().canRedo).toBe(false);
    });

    it('undo/redo SetGain restores correct value in mirror', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');
      const id = [...session.getState().tracks.keys()][0];

      await session.execute(session.makeSetGain(id, 1.5));
      expect(session.getState().tracks.get(id)!.gain).toBe(1.5);

      await session.undo();
      expect(session.getState().tracks.get(id)!.gain).toBe(1.0);

      await session.redo();
      expect(session.getState().tracks.get(id)!.gain).toBe(1.5);
    });

    it('undo SetGain reverts label', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');
      const id = [...session.getState().tracks.keys()][0];
      await session.execute(session.makeSetGain(id, 1.8));

      expect(session.getState().undoLabel).toBe('Set Gain');
      await session.undo();
      expect(session.getState().undoLabel).toBe('Add Track');
    });

    it('undo RemoveTrack re-adds track and restores params', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, tonePCM(512), null, 'T');
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
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');
      const id = [...session.getState().tracks.keys()][0];

      await session.execute(session.makeSetPluginParam(id, EQPlugin, 'band0_gain', 6.0));

      expect(session.getState().tracks.get(id)!.plugins['eq']['band0_gain']).toBe(6.0);
    });

    it('undo SetPluginParam restores previous value', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');
      const id = [...session.getState().tracks.keys()][0];

      await session.execute(session.makeSetPluginParam(id, EQPlugin, 'band0_gain', 6.0));
      await session.undo();

      expect(session.getState().tracks.get(id)!.plugins['eq']['band0_gain']).toBe(0); // default
    });

    it('redo SetPluginParam re-applies value', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');
      const id = [...session.getState().tracks.keys()][0];

      await session.execute(session.makeSetPluginParam(id, EQPlugin, 'band1_freq', 2000));
      await session.undo();
      await session.redo();

      expect(session.getState().tracks.get(id)!.plugins['eq']['band1_freq']).toBe(2000);
    });

    it('SetPluginParam command description includes plugin and param label', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');
      const id = [...session.getState().tracks.keys()][0];

      await session.execute(session.makeSetPluginParam(id, EQPlugin, 'band0_gain', 3.0));
      expect(session.getState().undoLabel).toBe('Set eq.Low Shelf Gain');
    });

    it('throws on unknown param id', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');
      const id = [...session.getState().tracks.keys()][0];

      expect(() => session.makeSetPluginParam(id, EQPlugin, 'bad_param', 1)).toThrow();
    });

    it('undo RemoveTrack restores EQ plugin params generically', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, tonePCM(512), null, 'T');
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
      const { session, worklet, store } = await makeSession();
      await addTrack(session, store, silentPCM(1024), null, 'T');
      worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
      await new Promise((r) => setTimeout(r, 5));

      const { L, R } = worklet.processBlock();
      expect(L.every((v) => Math.abs(v) < 1e-7)).toBe(true);
      expect(R.every((v) => Math.abs(v) < 1e-7)).toBe(true);
    });

    it('0.5 PCM track produces expected output through full chain', async () => {
      const { session, worklet, store } = await makeSession();
      await addTrack(session, store, tonePCM(1024, 0.5), null, 'T');
      worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
      await new Promise((r) => setTimeout(r, 5));

      const { L } = worklet.processBlock();
      // tanh(0.5 * cos(π/4)) ≈ 0.3395
      expect(Math.abs(L[0] - 0.3395)).toBeLessThan(0.001);
    });

    it('muting a track via Session silences WASM output', async () => {
      const { session, worklet, store } = await makeSession();
      await addTrack(session, store, tonePCM(1024, 0.5), null, 'T');
      const id = [...session.getState().tracks.keys()][0];
      await session.execute(session.makeSetMute(id, true));

      worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
      await new Promise((r) => setTimeout(r, 5));

      const { L } = worklet.processBlock();
      expect(L.every((v) => Math.abs(v) < 1e-7)).toBe(true);
    });

    it('undo SetMute restores audible output', async () => {
      const { session, worklet, store } = await makeSession();
      await addTrack(session, store, tonePCM(1024, 0.5), null, 'T');
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
      const { session, worklet, store } = await makeSession();
      // Use a non-trivial signal so EQ has something to act on
      await addTrack(session, store, tonePCM(1024, 0.1), null, 'T');
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
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');
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

  describe('Region model', () => {
    it('AddTrack creates a region with startFrame=0 in arrange state', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(1024), null, 'T');

      const state = session.getState();
      expect(state.arrange.regions.size).toBe(1);
      const [region] = [...state.arrange.regions.values()];
      const trackId = [...state.tracks.keys()][0];
      expect(region.trackId).toBe(trackId);
      expect(region.startFrame).toBe(0);
      expect(region.trimStartFrame).toBe(0);
      expect(region.trimEndFrame).toBe(1024);
    });

    it('makeAddTrack with initialStartFrame places region at that offset', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(1024), null, 'T', 44100);

      const [region] = [...session.getState().arrange.regions.values()];
      expect(region.startFrame).toBe(44100);
    });

    it('undo AddTrack removes region from arrange state', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');
      await session.undo();
      expect(session.getState().arrange.regions.size).toBe(0);
    });

    it('redo AddTrack restores region with same regionId', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, silentPCM(256), null, 'T');
      const idBefore = [...session.getState().arrange.regions.keys()][0];
      await session.undo();
      await session.redo();
      const idAfter = [...session.getState().arrange.regions.keys()][0];
      expect(idAfter).toBe(idBefore);
    });

    it('waveform peaks are registered after AddTrack (keyed by regionId)', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, tonePCM(1024, 0.7), null, 'T');
      const regionId = [...session.getState().arrange.regions.keys()][0];
      const peaks = session.getWaveformPeaks(regionId);
      expect(peaks).toBeDefined();
      expect(peaks!.peaksL.length).toBeGreaterThan(0);
      expect(peaks!.peaksL.every(v => Math.abs(v - 0.7) < 1e-5)).toBe(true);
    });

    it('waveform peaks are unregistered after undo AddTrack', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, tonePCM(256), null, 'T');
      const regionId = [...session.getState().arrange.regions.keys()][0];
      await session.undo();
      expect(session.getWaveformPeaks(regionId)).toBeUndefined();
    });

    it('makeMoveRegion updates startFrame in region map', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, tonePCM(44100), null, 'T');
      const regionId = [...session.getState().arrange.regions.keys()][0];
      await session.execute(session.makeMoveRegion(regionId, 22050));
      expect(session.getState().arrange.regions.get(regionId)!.startFrame).toBe(22050);
    });

    it('undo MoveRegion restores startFrame', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, tonePCM(44100), null, 'T');
      const regionId = [...session.getState().arrange.regions.keys()][0];
      await session.execute(session.makeMoveRegion(regionId, 22050));
      await session.undo();
      expect(session.getState().arrange.regions.get(regionId)!.startFrame).toBe(0);
    });

    it('redo MoveRegion re-applies startFrame', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, tonePCM(44100), null, 'T');
      const regionId = [...session.getState().arrange.regions.keys()][0];
      await session.execute(session.makeMoveRegion(regionId, 22050));
      await session.undo();
      await session.redo();
      expect(session.getState().arrange.regions.get(regionId)!.startFrame).toBe(22050);
    });

    it('MoveRegion delays audio output in WASM', async () => {
      const { session, worklet, store } = await makeSession();
      await addTrack(session, store, tonePCM(44100, 0.5), null, 'T');
      const regionId = [...session.getState().arrange.regions.keys()][0];
      // Move region to start at frame 256 — two 128-frame blocks must be silent
      await session.execute(session.makeMoveRegion(regionId, 256));

      worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
      await new Promise((r) => setTimeout(r, 5));

      const { L: L1 } = worklet.processBlock();
      const { L: L2 } = worklet.processBlock();
      expect(L1.every(v => Math.abs(v) < 1e-7)).toBe(true);
      expect(L2.every(v => Math.abs(v) < 1e-7)).toBe(true);

      // Third block (frames 256-383) has audio
      const { L: L3 } = worklet.processBlock();
      expect(L3.some(v => Math.abs(v) > 0.01)).toBe(true);
    });

    it('TrimRegion trims audio output', async () => {
      // PCM: silent for first 256 frames, then 0.5 for remaining 256
      const pcm = new Float32Array(512);
      pcm.fill(0.5, 256);
      const { session, worklet, store } = await makeSession();
      await addTrack(session, store, pcm, null, 'T');
      const regionId = [...session.getState().arrange.regions.keys()][0];

      // Trim off the silent first 256 frames
      await session.execute(session.makeTrimRegion(regionId, 256, 512));

      worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
      await new Promise((r) => setTimeout(r, 5));

      // First block should now be the loud part
      const { L } = worklet.processBlock();
      expect(L.some(v => Math.abs(v) > 0.01)).toBe(true);
    });

    it('undo TrimRegion restores original audio', async () => {
      const pcm = new Float32Array(512);
      pcm.fill(0.5, 256); // silent first 256, loud last 256
      const { session, worklet, store } = await makeSession();
      await addTrack(session, store, pcm, null, 'T');
      const regionId = [...session.getState().arrange.regions.keys()][0];

      await session.execute(session.makeTrimRegion(regionId, 256, 512));
      await session.undo();

      worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
      await new Promise((r) => setTimeout(r, 5));

      // First block should be silent again (original start)
      const { L } = worklet.processBlock();
      expect(L.every(v => Math.abs(v) < 1e-7)).toBe(true);
    });

    it('cross-track MoveRegion updates region trackId', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, tonePCM(256), null, 'Track A');
      await addTrack(session, store, tonePCM(256), null, 'Track B');

      const state = session.getState();
      const trackIds = [...state.tracks.keys()];
      const [trackAId, trackBId] = trackIds;
      const regionId = [...state.arrange.regions.values()].find(r => r.trackId === trackAId)!.regionId;

      // Move the region from Track A to Track B
      await session.execute(session.makeMoveRegion(regionId, 0, trackBId));

      const movedRegion = session.getState().arrange.regions.get(regionId)!;
      expect(movedRegion.trackId).toBe(trackBId);
    });

    it('undo cross-track MoveRegion restores original trackId', async () => {
      const { session, store } = await makeSession();
      await addTrack(session, store, tonePCM(256), null, 'Track A');
      await addTrack(session, store, tonePCM(256), null, 'Track B');

      const state = session.getState();
      const trackIds = [...state.tracks.keys()];
      const [trackAId, trackBId] = trackIds;
      const regionId = [...state.arrange.regions.values()].find(r => r.trackId === trackAId)!.regionId;

      await session.execute(session.makeMoveRegion(regionId, 0, trackBId));
      await session.undo();

      const restoredRegion = session.getState().arrange.regions.get(regionId)!;
      expect(restoredRegion.trackId).toBe(trackAId);
    });

    it('cross-track MoveRegion applies destination track settings (mute) to WASM slot', async () => {
      const { session, worklet, store } = await makeSession();
      await addTrack(session, store, tonePCM(1024, 0.5), null, 'Source');
      await addTrack(session, store, silentPCM(256), null, 'Dest');

      const state = session.getState();
      const trackIds = [...state.tracks.keys()];
      const [srcId, destId] = trackIds;

      // Mute the destination track before the move
      await session.execute(session.makeSetMute(destId, true));

      const regionId = [...state.arrange.regions.values()].find(r => r.trackId === srcId)!.regionId;

      // Move source region to the muted destination track
      await session.execute(session.makeMoveRegion(regionId, 0, destId));

      // Verify region's trackId updated
      expect(session.getState().arrange.regions.get(regionId)!.trackId).toBe(destId);

      // The moved region's WASM slot should now be muted (dest track settings applied)
      worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
      await new Promise((r) => setTimeout(r, 5));
      const { L } = worklet.processBlock();
      expect(L.every(v => Math.abs(v) < 1e-7)).toBe(true);
    });
  });

  describe('Master gain', () => {
    it('undo/redo SetMasterGain', async () => {
      const { session, store } = await makeSession();
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
