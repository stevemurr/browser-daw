// MemoryPanel.tsx — dev-mode memory stats overlay.
// Displays WASM heap, chunk buffer estimates, OPFS usage, and JS heap.
// Only rendered in development builds (guarded in App.tsx via import.meta.env.DEV).

import { useState, useEffect } from 'react';
import type { AudioEngine } from '../AudioEngine.js';
import type { AudioFileStore } from '../store/AudioFileStore.js';
import type { ChunkCacheManager } from '../ChunkCacheManager.js';

interface Props {
  engine: AudioEngine;
  chunks: ChunkCacheManager;
  store: AudioFileStore;
}

interface Stats {
  wasmHeapMB: number;
  chunksMB: number;
  chunkSlots: number;
  opfsMB: number;
  jsHeapMB: number | null;
}

function mb(bytes: number) {
  const v = bytes / (1024 * 1024);
  return v >= 100 ? `${v.toFixed(0)} MB`
       : v >= 10  ? `${v.toFixed(1)} MB`
       :             `${v.toFixed(2)} MB`;
}

export function MemoryPanel({ engine, chunks, store }: Props) {
  const [stats, setStats] = useState<Stats>({
    wasmHeapMB: 0, chunksMB: 0, chunkSlots: 0, opfsMB: 0, jsHeapMB: null,
  });

  // WASM heap size comes in on every playhead tick (~740 ms intervals)
  useEffect(() => {
    engine.onWasmHeapUpdate(bytes => {
      setStats(s => ({ ...s, wasmHeapMB: bytes / (1024 * 1024) }));
    });
  }, [engine]);

  // Poll everything else once per second
  useEffect(() => {
    async function poll() {
      // JS heap (Chrome only — undefined in other browsers)
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
      const jsHeapMB = perf.memory ? perf.memory.usedJSHeapSize / (1024 * 1024) : null;

      // OPFS usage derived from stored file metadata (numFrames × numChannels × 4 B)
      let opfsMB = 0;
      try {
        const files = await store.listFiles();
        opfsMB = files.reduce((sum, f) => sum + f.numFrames * f.numChannels * 4, 0) / (1024 * 1024);
      } catch { /* OPFS unavailable */ }

      // Active chunk buffer estimate from ChunkCacheManager
      const { bytes: chunkBytes, slots: chunkSlots } = chunks.getActiveChunkBytes();
      const chunksMB = chunkBytes / (1024 * 1024);

      setStats(s => ({ ...s, jsHeapMB, opfsMB, chunksMB, chunkSlots }));
    }

    const id = setInterval(() => { poll().catch(() => {}); }, 1000);
    poll().catch(() => {});
    return () => clearInterval(id);
  }, [chunks, store]);

  return (
    <div className="memory-panel">
      <div className="memory-panel-header">MEM</div>
      <Row label="WASM heap" value={mb(stats.wasmHeapMB * 1024 * 1024)} />
      <Row
        label="  chunks"
        value={`${mb(stats.chunksMB * 1024 * 1024)} · ${stats.chunkSlots} slot${stats.chunkSlots !== 1 ? 's' : ''}`}
        dim
      />
      <Row label="OPFS" value={mb(stats.opfsMB * 1024 * 1024)} />
      {stats.jsHeapMB !== null && (
        <Row label="JS heap" value={mb(stats.jsHeapMB * 1024 * 1024)} />
      )}
    </div>
  );
}

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className={`memory-row${dim ? ' memory-row-dim' : ''}`}>
      <span className="memory-label">{label}</span>
      <span className="memory-value">{value}</span>
    </div>
  );
}
