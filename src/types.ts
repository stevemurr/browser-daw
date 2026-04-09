// ── Shared types ─────────────────────────────────────────────────────────────

import type { PluginParamState } from './plugin.js';

export interface TrackMirror {
  stableId: string;      // permanent UUID, Session-assigned
  engineSlot: number;    // volatile (0-31), engine-assigned — may change on redo
  name: string;
  gain: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  // Plugin state: pluginKey → { paramId → value }
  // e.g. plugins['eq']['band0_gain'] = 3.0
  plugins: Record<string, PluginParamState>;
  // Retained PCM so AddTrack/RemoveTrack commands can undo/redo
  pcmL: Float32Array;
  pcmR: Float32Array | null;
  numFrames: number;
  sampleRate: number;
}

export interface SessionState {
  tracks: Map<string, TrackMirror>;  // keyed by stableId
  masterGain: number;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

// ── Worklet port abstraction ──────────────────────────────────────────────────
// AudioWorkletNode.port satisfies this interface.
// SimulatedWorklet also satisfies it for Node tests.

export interface IWorkletPort {
  postMessage(data: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}
