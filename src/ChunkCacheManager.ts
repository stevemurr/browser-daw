// ChunkCacheManager.ts — playhead-following prefetch of OPFS audio chunks.
//
// Watches for `chunk_needed` events from the AudioEngine (fired by the worklet
// when a track's loaded chunk is within 5 s of exhaustion) and pre-fetches the
// next chunk from the AudioFileStore.
//
// Also reloads chunks on seek and trim so that the WASM engine always has the
// correct audio data resident.

import type { AudioEngine } from './AudioEngine.js';
import type { AudioFileStore } from './store/AudioFileStore.js';

/** Source-file frame space metadata for one WASM slot. */
export interface SlotMeta {
  fileId: string;
  trimStartFrame: number;
  trimEndFrame: number;
  numFrames: number;
  /** Global timeline position where this region starts (= engine start_frame + trimStartFrame). */
  regionStartFrame: number;
}

/** One chunk: 10 s at 44.1 kHz = 441,000 frames. */
export const CHUNK_FRAMES = 441_000;

// ── Instrumentation ───────────────────────────────────────────────────────────

export type ChunkEventKind =
  | 'register'    // registerSlot called — initial chunk about to load
  | 'prefetch'    // chunk_needed received with remaining > 0 (on-time prefetch)
  | 'dropout'     // chunk_needed received with remaining === 0 (boundary already passed)
  | 'opfs-start'  // store.loadChunk() begins
  | 'opfs-end'    // store.loadChunk() complete
  | 'sent'        // engine.loadChunk() postMessage dispatched to worklet
  | 'loaded'      // chunk_loaded ack received — chunk is now in WASM
  | 'seek'        // seek-triggered reload started
  | 'trim'        // trim-triggered reload started
  | 'error';      // any load failure

export interface ChunkEvent {
  /** Wall-clock ms (Date.now()) when the event was recorded. */
  ts: number;
  /** ms since the first event in this log (easier to scan than absolute timestamps). */
  elapsed: number;
  kind: ChunkEventKind;
  slot: number;
  detail: Record<string, number | string>;
}

const LOG_MAX = 1000;

export class ChunkCacheManager {
  private slotMeta = new Map<number, SlotMeta>();
  // Tracks slots that have a chunk_needed request in flight to avoid duplicates.
  private pendingPrefetch = new Set<number>();

  // ── Event log ─────────────────────────────────────────────────────────────
  private _log: ChunkEvent[] = [];
  private _t0 = 0; // Date.now() of first logged event

  private _emit(kind: ChunkEventKind, slot: number, detail: Record<string, number | string> = {}): void {
    const ts = Date.now();
    if (this._log.length === 0) this._t0 = ts;
    if (this._log.length >= LOG_MAX) this._log.shift();
    this._log.push({ ts, elapsed: ts - this._t0, kind, slot, detail });
  }

  /** Returns a copy of the event log (most recent entries last). */
  getEventLog(): ChunkEvent[] {
    return [...this._log];
  }

  /** Prints a formatted table to the browser console for quick inspection. */
  printLog(): void {
    if (this._log.length === 0) {
      console.log('[ChunkCacheManager] No events recorded yet.');
      return;
    }
    console.table(
      this._log.map(e => ({
        '+ms':    e.elapsed.toFixed(1),
        kind:     e.kind,
        slot:     e.slot,
        ...e.detail,
      })),
    );
  }

  /** Snapshot of current slot metadata (fileId, trim bounds, region position). */
  getSlotState(): Record<number, SlotMeta & { pending: boolean }> {
    const out: Record<number, SlotMeta & { pending: boolean }> = {};
    for (const [slot, meta] of this.slotMeta) {
      out[slot] = { ...meta, pending: this.pendingPrefetch.has(slot) };
    }
    return out;
  }

  /** Reset the event log. */
  clearLog(): void {
    this._log = [];
    this._t0  = 0;
  }

  /**
   * Estimated bytes currently allocated in WASM linear memory for audio chunks.
   * Each active slot holds up to two chunks in the double-buffer (current + queued
   * prefetch).  Assumes stereo (2 ch × 4 B) as the upper bound.
   */
  getActiveChunkBytes(): { bytes: number; slots: number } {
    let bytes = 0;
    for (const meta of this.slotMeta.values()) {
      const frames = Math.min(CHUNK_FRAMES, meta.trimEndFrame - meta.trimStartFrame);
      // current + next_chunk × 2 channels × 4 bytes/sample
      bytes += frames * 2 * 4 * 2;
    }
    return { bytes, slots: this.slotMeta.size };
  }

  constructor(
    private engine: AudioEngine,
    private store: AudioFileStore,
  ) {
    this.engine.onChunkNeeded(this._onChunkNeeded.bind(this));
    this.engine.onSeekDone(this._onSeekDone.bind(this));
  }

  // ── Slot registration ────────────────────────────────────────────────────

  /** Register a new slot and immediately load its initial chunk. Returns when chunk is loaded. */
  async registerSlot(slot: number, meta: SlotMeta): Promise<void> {
    this.slotMeta.set(slot, meta);
    this._emit('register', slot, {
      fileId: meta.fileId.slice(0, 8),
      trimStart: meta.trimStartFrame,
      trimEnd: meta.trimEndFrame,
      regionStart: meta.regionStartFrame,
    });
    await this._loadChunk(slot, meta.trimStartFrame);
  }

  unregisterSlot(slot: number): void {
    this.slotMeta.delete(slot);
    this.pendingPrefetch.delete(slot);
  }

  // ── Trim / seek ──────────────────────────────────────────────────────────

  /** Called when a region's trim points change. Reloads the chunk covering the new trim start. */
  async handleTrimChange(
    slot: number,
    newTrimStart: number,
    newTrimEnd: number,
    regionStartFrame: number,
  ): Promise<void> {
    const meta = this.slotMeta.get(slot);
    if (!meta) return;
    const updated: SlotMeta = { ...meta, trimStartFrame: newTrimStart, trimEndFrame: newTrimEnd, regionStartFrame };
    this.slotMeta.set(slot, updated);
    this.pendingPrefetch.delete(slot);
    this._emit('trim', slot, { newTrimStart, newTrimEnd, regionStartFrame });
    await this._loadChunk(slot, newTrimStart);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private async _loadChunk(slot: number, sourceStartFrame: number): Promise<void> {
    const meta = this.slotMeta.get(slot);
    if (!meta) return;

    // Clamp length to the trimmed region
    const maxLength = meta.trimEndFrame - sourceStartFrame;
    if (maxLength <= 0) return; // past end of trimmed content

    const length = Math.min(CHUNK_FRAMES, maxLength);

    // ── OPFS read ────────────────────────────────────────────────────────
    this._emit('opfs-start', slot, { sourceStartFrame, length });
    const opfsT0 = Date.now();
    let chunkL: Float32Array;
    let chunkR: Float32Array | null;
    try {
      ({ chunkL, chunkR } = await this.store.loadChunk(meta.fileId, sourceStartFrame, length));
    } catch (err) {
      this._emit('error', slot, { phase: 'opfs', sourceStartFrame, msg: String(err) });
      this.pendingPrefetch.delete(slot);
      this.engine.chunkLoadFailed(slot);
      throw err;
    }
    // Scan a sample of frames to confirm the OPFS data is non-zero.
    // A maxAbs of 0.0 means the file was written as all-zeros (corrupt write).
    let maxAbs = 0;
    const scanLen = Math.min(chunkL.length, 2000);
    for (let i = 0; i < scanLen; i++) {
      const v = Math.abs(chunkL[i]);
      if (v > maxAbs) maxAbs = v;
    }
    this._emit('opfs-end', slot, {
      sourceStartFrame,
      length: chunkL.length,
      opfsMs: Date.now() - opfsT0,
      maxAbs: +maxAbs.toFixed(4),
    });

    // ── Transfer to worklet ──────────────────────────────────────────────
    this._emit('sent', slot, { sourceStartFrame, chunkLength: chunkL.length });
    const sentT0 = Date.now();
    try {
      await this.engine.loadChunk(slot, chunkL, chunkR, sourceStartFrame, chunkL.length);
    } catch (err) {
      this._emit('error', slot, { phase: 'worklet', sourceStartFrame, msg: String(err) });
      this.pendingPrefetch.delete(slot);
      this.engine.chunkLoadFailed(slot);
      throw err;
    }
    this._emit('loaded', slot, {
      sourceStartFrame,
      chunkLength: chunkL.length,
      xferMs: Date.now() - sentT0,
    });

    this.pendingPrefetch.delete(slot);
  }

  private _onChunkNeeded(slot: number, currentChunkEnd: number, kind: 'prefetch' | 'dropout'): void {
    // currentChunkEnd is in source-file frame space (chunk_start + chunk_length from C engine).
    if (this.pendingPrefetch.has(slot)) return;
    const meta = this.slotMeta.get(slot);
    if (!meta) return;
    if (currentChunkEnd >= meta.trimEndFrame) return; // already at end of file

    this._emit(kind, slot, { currentChunkEnd, trimEnd: meta.trimEndFrame });

    this.pendingPrefetch.add(slot);
    this._loadChunk(slot, currentChunkEnd).catch(err => {
      console.error('[ChunkCacheManager] prefetch error:', err);
      this.pendingPrefetch.delete(slot);
      // Tell the worklet to clear its _pendingChunkRequests for this slot so the
      // next poll cycle can retry. Without this, the worklet's pending set gets
      // stuck and no further chunk_needed events fire for this slot.
      this.engine.chunkLoadFailed(slot);
    });
  }

  private _onSeekDone(playheadPosition: number): void {
    // Reload chunks for all active slots to cover the new playhead position.
    for (const [slot, meta] of this.slotMeta) {
      const srcPos = (playheadPosition - meta.regionStartFrame) + meta.trimStartFrame;
      const chunkStart = Math.max(meta.trimStartFrame, Math.floor(srcPos / CHUNK_FRAMES) * CHUNK_FRAMES);
      if (chunkStart >= meta.trimEndFrame) continue;
      this.pendingPrefetch.delete(slot);
      this._emit('seek', slot, { playheadPosition, chunkStart });
      this._loadChunk(slot, chunkStart).catch(err => {
        console.error('[ChunkCacheManager] seek reload error:', err);
        this._emit('error', slot, { phase: 'seek', chunkStart, msg: String(err) });
      });
    }
  }
}
