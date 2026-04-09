// ── Shared types ─────────────────────────────────────────────────────────────

import type { PluginParamState } from './plugin.js';

export interface Region {
  regionId: string;       // UUID, permanent
  trackId: string;        // stableId of owning track (can change on cross-track move)
  startFrame: number;     // global timeline position (offset from session start)
  trimStartFrame: number; // sample offset into source PCM (default 0)
  trimEndFrame: number;   // exclusive end in source PCM (default numFrames)
  // Audio data owned by the region (moves with it across tracks)
  engineSlot: number;     // volatile (0-31), C-engine slot
  pcmL: Float32Array;     // original full-length source PCM (not trimmed)
  pcmR: Float32Array | null;
  numFrames: number;      // full source length before any trim
  sampleRate: number;
}

/**
 * View-model for React components — Region minus the large PCM buffers.
 * Passing Float32Arrays through React props causes React DevTools to serialize
 * all elements (O(numFrames) object allocations), triggering GC pauses of 1–2 s
 * on cross-track drags.  Components only need geometry; Session retains PCM internally.
 */
export type RegionView = Omit<Region, 'pcmL' | 'pcmR'>;

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
