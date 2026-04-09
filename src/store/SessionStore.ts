// SessionStore.ts — save/load/list/delete sessions in IndexedDB.
// restoreSession() re-hydrates a SerializedSession into a live Session instance.

import { getDb, idbPut, idbGet, idbDelete, idbGetAll } from './idb.js';
import type { AudioEngine } from '../AudioEngine.js';
import type { AudioFileStore } from './AudioFileStore.js';
import type { ChunkCacheManager, SlotMeta } from '../ChunkCacheManager.js';
import {
  Session,
  type SerializedSession,
  type SessionListItem,
} from '../Session.js';

export type { SerializedSession, SessionListItem };

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function saveSession(session: SerializedSession): Promise<void> {
  const db = await getDb();
  await idbPut(db, 'sessions', session);
}

export async function loadSession(sessionId: string): Promise<SerializedSession | null> {
  const db     = await getDb();
  const result = await idbGet<SerializedSession>(db, 'sessions', sessionId);
  return result ?? null;
}

export async function listSessions(): Promise<SessionListItem[]> {
  const db  = await getDb();
  const all = await idbGetAll<SerializedSession>(db, 'sessions');
  return all
    .map(({ sessionId, name, createdAt, updatedAt }) => ({ sessionId, name, createdAt, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = await getDb();
  await idbDelete(db, 'sessions', sessionId);
}

export async function getMostRecentSessionId(): Promise<string | null> {
  const sessions = await listSessions();
  return sessions[0]?.sessionId ?? null;
}

/**
 * Returns "Session N" where N is the lowest positive integer not already used
 * by any name in `existing`.  Pass the current session list so new sessions
 * get a unique default name even if earlier sessions were deleted.
 */
export function generateDefaultName(existing: SessionListItem[] = []): string {
  const usedNums = new Set(
    existing.map(s => {
      const m = /^Session (\d+)$/.exec(s.name);
      return m ? parseInt(m[1], 10) : 0;
    }),
  );
  let n = 1;
  while (usedNums.has(n)) n++;
  return `Session ${n}`;
}

// ── Restore ───────────────────────────────────────────────────────────────────

/**
 * Re-hydrates a SerializedSession into a live Session instance.
 * Uses the lower-level Session._register* API to bypass the command pattern
 * so the undo stack starts empty after restore.
 *
 * Missing OPFS files are handled gracefully: the region is registered with a
 * zeroed chunk (silence), and a warning is logged.
 */
export async function restoreSession(
  saved: SerializedSession,
  engine: AudioEngine,
  chunks: ChunkCacheManager,
  store: AudioFileStore,
): Promise<Session> {
  const session = new Session(engine, store, chunks);

  // Restore master gain to both the JS mirror and the WASM engine
  session._setMasterGain(saved.masterGain);
  engine.setMasterGain(saved.masterGain);

  // Determine which audio files still exist in OPFS
  const existing     = await store.listFiles();
  const existingSet  = new Set(existing.map(f => f.fileId));

  for (const savedTrack of saved.tracks) {
    // Register track mirror with the saved channel-strip state (not defaults)
    session._registerTrack(savedTrack.stableId, {
      name:    savedTrack.name,
      gain:    savedTrack.gain,
      pan:     savedTrack.pan,
      muted:   savedTrack.muted,
      soloed:  savedTrack.soloed,
      plugins: savedTrack.plugins,
    });

    for (const savedRegion of savedTrack.regions) {
      const fileExists = existingSet.has(savedRegion.fileId);
      if (!fileExists) {
        console.warn(
          `[SessionStore] restoreSession: fileId=${savedRegion.fileId} missing from OPFS — region "${savedRegion.regionId}" will play silence`,
        );
      }

      // Allocate a new WASM slot for this region
      const slot = await engine.addTrackChunked(savedRegion.numFrames, savedRegion.sampleRate);

      // C engine: start_frame = regionStartFrame − trimStartFrame
      engine.setStartFrame(slot, savedRegion.startFrame - savedRegion.trimStartFrame);

      // Apply channel strip + plugin settings
      const track = session._getTrack(savedTrack.stableId)!;
      session._applyTrackSettings(track, slot);

      // Register the region mirror
      session._registerRegion({
        regionId:       savedRegion.regionId,
        trackId:        savedTrack.stableId,
        startFrame:     savedRegion.startFrame,
        trimStartFrame: savedRegion.trimStartFrame,
        trimEndFrame:   savedRegion.trimEndFrame,
        fileId:         savedRegion.fileId,
        engineSlot:     slot,
        numFrames:      savedRegion.numFrames,
        sampleRate:     savedRegion.sampleRate,
      });

      if (fileExists) {
        // Load the initial chunk into WASM from OPFS
        const slotMeta: SlotMeta = {
          fileId:           savedRegion.fileId,
          trimStartFrame:   savedRegion.trimStartFrame,
          trimEndFrame:     savedRegion.trimEndFrame,
          numFrames:        savedRegion.numFrames,
          regionStartFrame: savedRegion.startFrame,
        };
        await chunks.registerSlot(slot, slotMeta);

        // Restore waveform peaks from IndexedDB (stored by fileId; re-key with regionId)
        const peaks = await store.loadPeaks(savedRegion.fileId);
        if (peaks) {
          session._registerWaveformPeaks({ ...peaks, regionId: savedRegion.regionId });
        }
      }
    }
  }

  return session;
}
