// session.bpm.test.ts — tests for BPM state, commands, undo/redo, and persistence.

import { describe, it, expect } from 'vitest';
import { SimulatedWorklet } from './harness/SimulatedWorklet.js';
import { AudioEngine } from '../src/AudioEngine.js';
import { Session } from '../src/Session.js';
import { ChunkCacheManager } from '../src/ChunkCacheManager.js';
import type { AudioFileStore, AudioFileMeta } from '../src/store/AudioFileStore.js';
import type { WaveformPeaks } from '../src/types.js';
import { restoreSession } from '../src/store/SessionStore.js';
import type { SerializedSession } from '../src/Session.js';

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

async function makeSession(): Promise<{ session: Session; engine: AudioEngine; store: MockAudioFileStore; chunks: ChunkCacheManager }> {
  const worklet = new SimulatedWorklet();
  await worklet.ready_();
  const engine  = new AudioEngine(worklet);
  worklet.postMessage({ type: 'init' });
  await new Promise<void>(r => setTimeout(r, 10));
  const store   = new MockAudioFileStore();
  const chunks  = new ChunkCacheManager(engine, store);
  const session = new Session(engine, store, chunks);
  return { session, engine, store, chunks };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BPM session state', () => {
  it('default BPM is 120', async () => {
    const { session } = await makeSession();
    expect(session.getState().bpm).toBe(120);
  });

  it('makeSetBpm updates BPM in state', async () => {
    const { session } = await makeSession();
    await session.execute(session.makeSetBpm(140));
    expect(session.getState().bpm).toBe(140);
  });

  it('makeSetBpm clamps BPM to minimum 30', async () => {
    const { session } = await makeSession();
    await session.execute(session.makeSetBpm(10));
    expect(session.getState().bpm).toBe(30);
  });

  it('makeSetBpm clamps BPM to maximum 300', async () => {
    const { session } = await makeSession();
    await session.execute(session.makeSetBpm(999));
    expect(session.getState().bpm).toBe(300);
  });

  it('makeSetBpm rounds fractional BPM to nearest integer', async () => {
    const { session } = await makeSession();
    await session.execute(session.makeSetBpm(128.7));
    expect(session.getState().bpm).toBe(129);
  });
});

describe('BPM undo/redo', () => {
  it('undo restores previous BPM', async () => {
    const { session } = await makeSession();
    await session.execute(session.makeSetBpm(140));
    await session.undo();
    expect(session.getState().bpm).toBe(120);
  });

  it('redo re-applies new BPM after undo', async () => {
    const { session } = await makeSession();
    await session.execute(session.makeSetBpm(140));
    await session.undo();
    await session.redo();
    expect(session.getState().bpm).toBe(140);
  });

  it('sequential BPM changes each create separate undo entries', async () => {
    const { session } = await makeSession();
    await session.execute(session.makeSetBpm(100));
    await session.execute(session.makeSetBpm(200));
    expect(session.getState().bpm).toBe(200);
    await session.undo();
    expect(session.getState().bpm).toBe(100);
    await session.undo();
    expect(session.getState().bpm).toBe(120);
  });
});

describe('BPM serialization', () => {
  it('serialize() includes current BPM', async () => {
    const { session } = await makeSession();
    await session.execute(session.makeSetBpm(180));
    const s = session.serialize('id-1', 'Test');
    expect(s.bpm).toBe(180);
  });

  it('serialize() includes default BPM when unchanged', async () => {
    const { session } = await makeSession();
    const s = session.serialize('id-1', 'Test');
    expect(s.bpm).toBe(120);
  });
});

describe('BPM restore', () => {
  it('restoreSession() restores saved BPM', async () => {
    const { session, engine, store, chunks } = await makeSession();
    await session.execute(session.makeSetBpm(160));
    const saved = session.serialize('id-1', 'Test');

    const { session: restored } = await makeSession();
    const restoredSession = await restoreSession(saved, engine, chunks, store);
    expect(restoredSession.getState().bpm).toBe(160);
  });

  it('restoreSession() defaults to 120 when bpm field is missing (legacy data)', async () => {
    const { engine, store, chunks } = await makeSession();
    const legacySaved = {
      sessionId: 'id-legacy',
      name: 'Legacy',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      masterGain: 1.0,
      // bpm intentionally omitted
      tracks: [],
    } as unknown as SerializedSession;

    const restoredSession = await restoreSession(legacySaved, engine, chunks, store);
    expect(restoredSession.getState().bpm).toBe(120);
  });
});
