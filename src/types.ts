// ── Shared types ─────────────────────────────────────────────────────────────

import type { PluginParamState } from './plugin.js';

export interface Region {
  regionId: string;       // UUID, permanent
  trackId: string;        // stableId of owning track (can change on cross-track move)
  startFrame: number;     // global timeline position (offset from session start)
  trimStartFrame: number; // source-file frame offset where this region begins
  trimEndFrame: number;   // exclusive source-file frame end (default numFrames)
  // Audio identity — PCM lives in OPFS keyed by fileId; engine slot owns a window
  fileId: string;         // OPFS key for the source audio
  engineSlot: number;     // volatile (0-31), C-engine slot
  numFrames: number;      // full source file length (before any trim)
  sampleRate: number;
}

/**
 * Type alias kept for backward-compatibility with component imports.
 * Region no longer carries large PCM buffers, so there is nothing to strip.
 */
export type RegionView = Region;

export interface WaveformPeaks {
  regionId: string;
  peaksL: Float32Array;       // one value per PEAK_BLOCK_SIZE samples
  peaksR: Float32Array | null;
  blockSize: number;
}

export interface ArrangeState {
  regions: Map<string, RegionView>; // regionId → RegionView (PCM stripped for React)
}

export interface TrackMirror {
  stableId: string;      // permanent UUID, Session-assigned
  name: string;
  gain: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  // Plugin state: pluginKey → { paramId → value }
  // e.g. plugins['eq']['band0_gain'] = 3.0
  plugins: Record<string, PluginParamState>;
}

export interface SessionState {
  tracks: Map<string, TrackMirror>;  // keyed by stableId
  masterGain: number;
  bpm: number;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  arrange: ArrangeState;
}

// ── Worklet port abstraction ──────────────────────────────────────────────────
// AudioWorkletNode.port satisfies this interface.
// SimulatedWorklet also satisfies it for Node tests.

export interface IWorkletPort {
  postMessage(data: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}
