// session.persistence.test.ts — tests for Session.serialize() and restoreSession().
//
// These tests run headless in Node using the same SimulatedWorklet + MockAudioFileStore
// infrastructure as session.integration.test.ts.  IndexedDB (saveSession / loadSession)
// is browser-only and is not tested here.

import { describe, it, expect } from 'vitest';
import { SimulatedWorklet } from './harness/SimulatedWorklet.js';
import { AudioEngine } from '../src/AudioEngine.js';
import { Session } from '../src/Session.js';
import { ChunkCacheManager } from '../src/ChunkCacheManager.js';
import type { AudioFileStore, AudioFileMeta } from '../src/store/AudioFileStore.js';
import type { WaveformPeaks } from '../src/types.js';
import { restoreSession, generateDefaultName } from '../src/store/SessionStore.js';
import type { SerializedSession } from '../src/Session.js';
import { EQPlugin } from '../src/plugins/eq.plugin.js';

// ── MockAudioFileStore ────────────────────────────────────────────────────────

class MockAudioFileStore implements AudioFileStore {
  private pcm   = new Map<string, { L: Float32Array; R: Float32Array | null }>();
  private meta  = new Map<string, AudioFileMeta>();
  private peaks = new Map<string, WaveformPeaks>();

  async store(fileId: string, L: Float32Array, R: Float32Array | null, m: AudioFileMeta): Promise<void> {
    this.pcm.set(fileId, { L, R }); this.meta.set(fileId, m);
  }
  async loadChunk(fileId: string, startFrame: number, length: number): Promise<{ chunkL: Float32Array; chunkR: Float32Array | null }> {
    const data = this.pcm.get(fileId);
    if (!data) return { chunkL: new Float32Array(length), chunkR: null };
    const end    = Math.min(startFrame + length, data.L.length);
    const chunkL = data.L.slice(startFrame, end);
    if (chunkL.length < length) {
      const padded = new Float32Array(length); padded.set(chunkL); return { chunkL: padded, chunkR: null };
    }
    return { chunkL, chunkR: data.R ? data.R.slice(startFrame, end) : null };
  }
  async storePeaks(fileId: string, p: WaveformPeaks): Promise<void> { this.peaks.set(fileId, p); }
  async loadPeaks(fileId: string): Promise<WaveformPeaks | null>    { return this.peaks.get(fileId) ?? null; }
  async delete(fileId: string): Promise<void> { this.pcm.delete(fileId); this.meta.delete(fileId); this.peaks.delete(fileId); }
  async listFiles(): Promise<AudioFileMeta[]> { return [...this.meta.values()]; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tonePCM(frames: number, value = 0.5): Float32Array { return new Float32Array(frames).fill(value); }
function silentPCM(frames: number): Float32Array            { return new Float32Array(frames); }

async function makeSession(): Promise<{ session: Session; worklet: SimulatedWorklet; store: MockAudioFileStore; chunks: ChunkCacheManager; engine: AudioEngine }> {
  const worklet = new SimulatedWorklet();
  await worklet.ready_();
  const engine  = new AudioEngine(worklet);
  worklet.postMessage({ type: 'init' });
  await new Promise<void>(r => setTimeout(r, 10));
  const store   = new MockAudioFileStore();
  const chunks  = new ChunkCacheManager(engine, store);
  const session = new Session(engine, store, chunks);
  return { session, worklet, store, chunks, engine };
}

async function addTrack(
  session: Session, store: MockAudioFileStore,
  pcmL: Float32Array, pcmR: Float32Array | null,
  name: string, startFrame?: number,
): Promise<string> {
  const fileId = crypto.randomUUID();
  await store.store(fileId, pcmL, pcmR, {
    fileId, name, numFrames: pcmL.length, sampleRate: 44100, numChannels: pcmR ? 2 : 1,
  });
  await session.execute(session.makeAddTrack(fileId, name, pcmL.length, 44100, undefined, startFrame));
  return fileId;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Session.serialize()', () => {
  it('empty session serializes to empty tracks array', async () => {
    const { session } = await makeSession();
    const s = session.serialize('id-1', 'My Session');
    expect(s.sessionId).toBe('id-1');
    expect(s.name).toBe('My Session');
    expect(s.tracks).toHaveLength(0);
    expect(s.masterGain).toBe(1.0);
  });

  it('serializes track names, gain, pan, mute, solo', async () => {
    const { session, store } = await makeSession();
    await addTrack(session, store, tonePCM(256), null, 'Drums');
    const id = [...session.getState().tracks.keys()][0];
    await session.execute(session.makeSetGain(id, 1.5));
    await session.execute(session.makeSetPan(id, -0.3));
    await session.execute(session.makeSetMute(id, true));

    const s = session.serialize('sid', 'Test');
    expect(s.tracks).toHaveLength(1);
    const t = s.tracks[0];
    expect(t.name).toBe('Drums');
    expect(t.gain).toBe(1.5);
    expect(t.pan).toBeCloseTo(-0.3, 5);
    expect(t.muted).toBe(true);
    expect(t.soloed).toBe(false);
  });

  it('serializes region startFrame and trim values', async () => {
    const { session, store } = await makeSession();
    await addTrack(session, store, tonePCM(1024), null, 'Bass', 4410);
    const regionId = [...session.getState().arrange.regions.keys()][0];
    await session.execute(session.makeTrimRegion(regionId, 128, 900));

    const s = session.serialize('sid', 'T');
    const r = s.tracks[0].regions[0];
    expect(r.startFrame).toBe(4410);
    expect(r.trimStartFrame).toBe(128);
    expect(r.trimEndFrame).toBe(900);
    expect(r.numFrames).toBe(1024);
  });

  it('does not include engineSlot in serialized regions', async () => {
    const { session, store } = await makeSession();
    await addTrack(session, store, silentPCM(256), null, 'T');
    const s = session.serialize('sid', 'T');
    const r = s.tracks[0].regions[0] as Record<string, unknown>;
    expect(r['engineSlot']).toBeUndefined();
  });

  it('serializes plugin params (non-default EQ gain)', async () => {
    const { session, store } = await makeSession();
    await addTrack(session, store, silentPCM(256), null, 'T');
    const id = [...session.getState().tracks.keys()][0];
    await session.execute(session.makeSetPluginParam(id, EQPlugin, 'band1_gain', 9.0));

    const s = session.serialize('sid', 'T');
    expect(s.tracks[0].plugins['eq']['band1_gain']).toBe(9.0);
  });

  it('serializes masterGain', async () => {
    const { session, store } = await makeSession();
    await addTrack(session, store, silentPCM(64), null, 'T');
    await session.execute(session.makeSetMasterGain(0.5));
    const s = session.serialize('sid', 'T');
    expect(s.masterGain).toBe(0.5);
  });

  it('serialized output is JSON round-trip safe', async () => {
    const { session, store } = await makeSession();
    await addTrack(session, store, tonePCM(256), null, 'T');
    const original = session.serialize('sid', 'T');
    const restored = JSON.parse(JSON.stringify(original)) as SerializedSession;
    expect(restored.tracks[0].name).toBe('T');
    expect(restored.tracks[0].regions[0].numFrames).toBe(256);
  });
});

describe('restoreSession()', () => {
  it('restores track names and count', async () => {
    const { session, store, chunks, engine } = await makeSession();
    await addTrack(session, store, tonePCM(1024), null, 'Guitar');
    await addTrack(session, store, tonePCM(1024), null, 'Keys');

    const saved = session.serialize('sid', 'Proj');
    session.unloadSession();

    // New engine for restore (same worklet, same WASM state)
    const restored = await restoreSession(saved, engine, chunks, store);
    const names    = [...restored.getState().tracks.values()].map(t => t.name);
    expect(names).toContain('Guitar');
    expect(names).toContain('Keys');
    expect(restored.getState().tracks.size).toBe(2);
  });

  it('restores region startFrame and trim', async () => {
    const { session, store, chunks, engine } = await makeSession();
    await addTrack(session, store, tonePCM(1024), null, 'Vox', 22050);
    const regionId = [...session.getState().arrange.regions.keys()][0];
    await session.execute(session.makeTrimRegion(regionId, 256, 900));

    const saved = session.serialize('sid', 'T');
    session.unloadSession();
    const restored = await restoreSession(saved, engine, chunks, store);

    const region = [...restored.getState().arrange.regions.values()][0];
    expect(region.startFrame).toBe(22050);
    expect(region.trimStartFrame).toBe(256);
    expect(region.trimEndFrame).toBe(900);
  });

  it('restores plugin params', async () => {
    const { session, store, chunks, engine } = await makeSession();
    await addTrack(session, store, silentPCM(256), null, 'T');
    const id = [...session.getState().tracks.keys()][0];
    await session.execute(session.makeSetPluginParam(id, EQPlugin, 'band1_gain', 12.0));

    const saved = session.serialize('sid', 'T');
    session.unloadSession();
    const restored = await restoreSession(saved, engine, chunks, store);

    const track = [...restored.getState().tracks.values()][0];
    expect(track.plugins['eq']['band1_gain']).toBe(12.0);
  });

  it('restores masterGain', async () => {
    const { session, store, chunks, engine } = await makeSession();
    await addTrack(session, store, silentPCM(64), null, 'T');
    await session.execute(session.makeSetMasterGain(0.5));

    const saved = session.serialize('sid', 'T');
    session.unloadSession();
    const restored = await restoreSession(saved, engine, chunks, store);
    expect(restored.getState().masterGain).toBe(0.5);
  });

  it('restored muted track produces silent WASM output', async () => {
    const { session, worklet, store, chunks, engine } = await makeSession();
    await addTrack(session, store, tonePCM(1024, 0.5), null, 'T');
    const id = [...session.getState().tracks.keys()][0];
    await session.execute(session.makeSetMute(id, true));

    const saved = session.serialize('sid', 'T');
    session.unloadSession();
    const _ = await restoreSession(saved, engine, chunks, store);

    worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
    await new Promise(r => setTimeout(r, 5));
    const { L } = worklet.processBlock();
    expect(L.every(v => Math.abs(v) < 1e-7)).toBe(true);
  });

  it('missing file resolves without throwing; region exists but plays silence', async () => {
    const { session, worklet, store, chunks, engine } = await makeSession();
    await addTrack(session, store, tonePCM(1024, 0.5), null, 'T');
    const saved = session.serialize('sid', 'T');

    // Delete the OPFS file to simulate a missing file scenario
    const fileId = saved.tracks[0].regions[0].fileId;
    await store.delete(fileId);
    session.unloadSession();

    // Should not throw
    const restored = await restoreSession(saved, engine, chunks, store);
    expect(restored.getState().tracks.size).toBe(1);
    expect(restored.getState().arrange.regions.size).toBe(1);

    worklet.postMessage({ type: 'cmd', fn: 'engine_play' });
    await new Promise(r => setTimeout(r, 5));
    const { L } = worklet.processBlock();
    expect(L.every(v => Math.abs(v) < 1e-7)).toBe(true);
  });

  it('unloadSession() clears tracks and regions', async () => {
    const { session, store } = await makeSession();
    await addTrack(session, store, tonePCM(256), null, 'T');
    expect(session.getState().tracks.size).toBe(1);
    session.unloadSession();
    expect(session.getState().tracks.size).toBe(0);
    expect(session.getState().arrange.regions.size).toBe(0);
    expect(session.getState().canUndo).toBe(false);
  });
});

describe('generateDefaultName()', () => {
  it('returns Session 1 for empty list', () => {
    expect(generateDefaultName([])).toBe('Session 1');
  });

  it('increments past existing numbers', () => {
    const existing = [
      { sessionId: 'a', name: 'Session 1', createdAt: 0, updatedAt: 0 },
      { sessionId: 'b', name: 'Session 2', createdAt: 0, updatedAt: 0 },
    ];
    expect(generateDefaultName(existing)).toBe('Session 3');
  });

  it('fills gaps in the sequence', () => {
    const existing = [
      { sessionId: 'a', name: 'Session 1', createdAt: 0, updatedAt: 0 },
      { sessionId: 'b', name: 'Session 3', createdAt: 0, updatedAt: 0 },
    ];
    expect(generateDefaultName(existing)).toBe('Session 2');
  });

  it('ignores non-default names', () => {
    const existing = [
      { sessionId: 'a', name: 'My Mix', createdAt: 0, updatedAt: 0 },
    ];
    expect(generateDefaultName(existing)).toBe('Session 1');
  });
});
