// AudioFileStore.ts — storage abstraction for decoded audio PCM.
//
// Files are stored as raw Float32 binary in OPFS (one file per channel).
// Waveform peaks and metadata are stored in IndexedDB.
// The interface exists so an S3 backend can be plugged in later.
//
// IMPORTANT: OPFS is NOT available in AudioWorklet — all reads/writes
// must happen on the main thread (or a dedicated non-audio Worker).

import type { WaveformPeaks } from '../types.js';

export interface AudioFileMeta {
  fileId: string;
  name: string;
  numFrames: number;
  sampleRate: number;
  numChannels: number;
}

export interface AudioFileStore {
  /** Persist decoded PCM for a new file. Overwrites if fileId already exists. */
  store(
    fileId: string,
    channelL: Float32Array,
    channelR: Float32Array | null,
    meta: AudioFileMeta,
  ): Promise<void>;

  /**
   * Read a slice of decoded PCM from the store.
   * startFrame and length are in source-file frame space.
   * If length extends past the end of the file it is clamped.
   * Returns zeroed arrays on any read error (missing file, quota error, etc.)
   * and surfaces the error to the console so the caller stays silent.
   */
  loadChunk(
    fileId: string,
    startFrame: number,
    length: number,
  ): Promise<{ chunkL: Float32Array; chunkR: Float32Array | null }>;

  /** Persist waveform peak data keyed by fileId. */
  storePeaks(fileId: string, peaks: WaveformPeaks): Promise<void>;

  /** Load waveform peak data. Returns null if not found. */
  loadPeaks(fileId: string): Promise<WaveformPeaks | null>;

  /** Delete all stored data for a file (both OPFS and IndexedDB). */
  delete(fileId: string): Promise<void>;

  /** List all stored file metadata. */
  listFiles(): Promise<AudioFileMeta[]>;
}

// ── OPFS implementation ───────────────────────────────────────────────────────

const DB_NAME    = 'daw-metadata';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files'))
        db.createObjectStore('files', { keyPath: 'fileId' });
      if (!db.objectStoreNames.contains('peaks'))
        db.createObjectStore('peaks', { keyPath: 'fileId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror   = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror   = () => reject(req.error);
  });
}

export class OPFSAudioFileStore implements AudioFileStore {
  private db: IDBDatabase | null = null;
  // Per-fileId write-lock: chains each write for the same file so concurrent
  // store() calls for the same fileId don't interleave and corrupt the file.
  private writeLocks = new Map<string, Promise<void>>();

  private async _db(): Promise<IDBDatabase> {
    if (!this.db) this.db = await openDB();
    return this.db;
  }

  private async _opfsRoot(): Promise<FileSystemDirectoryHandle> {
    return navigator.storage.getDirectory();
  }

  private async _writeChannel(root: FileSystemDirectoryHandle, filename: string, data: Float32Array): Promise<void> {
    const handle  = await root.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    // Write the typed array view directly so byteOffset and byteLength are respected.
    // Writing data.buffer would write the entire backing ArrayBuffer from byte 0,
    // which is wrong if the view has a non-zero byteOffset.
    await writable.write(data);
    await writable.close();
  }

  private _enqueueWrite(fileId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.writeLocks.get(fileId) ?? Promise.resolve();
    const next = prev.then(fn).finally(() => {
      if (this.writeLocks.get(fileId) === next) this.writeLocks.delete(fileId);
    });
    this.writeLocks.set(fileId, next);
    return next;
  }

  async store(
    fileId: string,
    channelL: Float32Array,
    channelR: Float32Array | null,
    meta: AudioFileMeta,
  ): Promise<void> {
    return this._enqueueWrite(fileId, async () => {
      const root = await this._opfsRoot();
      await this._writeChannel(root, `${fileId}_L.f32`, channelL);
      if (channelR) await this._writeChannel(root, `${fileId}_R.f32`, channelR);
      const db = await this._db();
      await idbPut(db, 'files', meta);
    });
  }

  async loadChunk(
    fileId: string,
    startFrame: number,
    length: number,
  ): Promise<{ chunkL: Float32Array; chunkR: Float32Array | null }> {
    const empty = (n: number) => new Float32Array(n);
    try {
      const root    = await this._opfsRoot();
      const startB  = startFrame * 4;
      const endB    = (startFrame + length) * 4;

      const readChannel = async (filename: string): Promise<Float32Array | null> => {
        try {
          const handle = await root.getFileHandle(filename);
          const file   = await handle.getFile();
          if (file.size === 0) return null;
          // Slice to avoid reading the entire file into memory
          const clampedEnd = Math.min(endB, file.size);
          if (startB >= clampedEnd) return empty(0);
          const buf = await file.slice(startB, clampedEnd).arrayBuffer();
          return new Float32Array(buf);
        } catch {
          return null;
        }
      };

      const chunkL = await readChannel(`${fileId}_L.f32`);
      if (!chunkL) {
        console.error(`[AudioFileStore] Missing L channel for fileId=${fileId}`);
        return { chunkL: empty(length), chunkR: null };
      }
      const rawR   = await readChannel(`${fileId}_R.f32`);
      const chunkR = rawR ?? null;

      // Pad to requested length if file was shorter than expected
      if (chunkL.length < length) {
        const padded = empty(length);
        padded.set(chunkL);
        return { chunkL: padded, chunkR: chunkR ? (() => { const p = empty(length); p.set(chunkR); return p; })() : null };
      }
      return { chunkL, chunkR };
    } catch (err) {
      console.error('[AudioFileStore] loadChunk error:', err);
      return { chunkL: empty(length), chunkR: null };
    }
  }

  async storePeaks(fileId: string, peaks: WaveformPeaks): Promise<void> {
    const db = await this._db();
    // IndexedDB can't store Float32Array directly in all browsers reliably;
    // convert to plain Array for safety.
    await idbPut(db, 'peaks', {
      fileId,
      regionId: peaks.regionId,
      peaksL:   Array.from(peaks.peaksL),
      peaksR:   peaks.peaksR ? Array.from(peaks.peaksR) : null,
      blockSize: peaks.blockSize,
    });
  }

  async loadPeaks(fileId: string): Promise<WaveformPeaks | null> {
    const db  = await this._db();
    const raw = await idbGet<{
      fileId: string; regionId: string;
      peaksL: number[]; peaksR: number[] | null; blockSize: number;
    }>(db, 'peaks', fileId);
    if (!raw) return null;
    return {
      regionId: raw.regionId,
      peaksL:   new Float32Array(raw.peaksL),
      peaksR:   raw.peaksR ? new Float32Array(raw.peaksR) : null,
      blockSize: raw.blockSize,
    };
  }

  async delete(fileId: string): Promise<void> {
    try {
      const root = await this._opfsRoot();
      await root.removeEntry(`${fileId}_L.f32`).catch(() => {/* already gone */});
      await root.removeEntry(`${fileId}_R.f32`).catch(() => {/* mono file */});
    } catch { /* OPFS not available */ }
    const db = await this._db();
    await idbDelete(db, 'files', fileId);
    await idbDelete(db, 'peaks', fileId);
  }

  async listFiles(): Promise<AudioFileMeta[]> {
    const db = await this._db();
    return idbGetAll<AudioFileMeta>(db, 'files');
  }
}
