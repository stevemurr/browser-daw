// SimulatedWorklet.ts
// Implements IWorkletPort using the real WASM engine (Node build).
// Mirrors the message protocol of worklet.js so AudioEngine can't tell
// the difference in tests.

import { fileURLToPath } from 'url';
import path from 'path';
import type { IWorkletPort } from '../../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The Emscripten module object shape we care about
interface EmscriptenModule {
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  _engine_add_track(pL: number, pR: number, frames: number, sr: number): number;
  _engine_remove_track(id: number): void;
  _engine_set_gain(id: number, v: number): void;
  _engine_set_pan(id: number, v: number): void;
  _engine_set_mute(id: number, v: number): void;
  _engine_set_solo(id: number, v: number): void;
  _engine_plugin_set_param(id: number, pluginId: number, paramId: number, value: number): void;
  _engine_set_start_frame(id: number, startFrame: number): void;
  _engine_play(): void;
  _engine_pause(): void;
  _engine_seek(pos: number): void;
  _engine_get_playhead(): number;
  _engine_is_playing(): number;
  _engine_set_master_gain(v: number): void;
  _engine_process(pL: number, pR: number, frames: number): void;
  HEAPF32: Float32Array;
}

type WorkletMsg = { data: unknown };

export class SimulatedWorklet implements IWorkletPort {
  onmessage: ((e: WorkletMsg) => void) | null = null;

  private M: EmscriptenModule | null = null;
  private initPromise: Promise<void>;
  private ready = false;

  constructor() {
    this.initPromise = this._loadWasm();
  }

  private async _loadWasm(): Promise<void> {
    // audio_engine_node.cjs is a CJS Emscripten module.
    // Dynamic import() works for both ESM and CJS; the factory sits on .default.
    const modUrl = new URL('../../test/audio_engine_node.cjs', import.meta.url).href;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import(modUrl) as any;
    const factory = (mod.default ?? mod) as (opts?: unknown) => Promise<EmscriptenModule>;
    this.M = await factory();
    this.ready = true;
  }

  // Called by AudioEngine (main-thread side) to send a message to the "worklet"
  postMessage(data: unknown): void {
    const msg = data as { type: string };

    if (msg.type === 'init') {
      this.initPromise.then(() => {
        this.onmessage?.({ data: { type: 'ready' } });
      });
      return;
    }

    if (msg.type === 'cmd') {
      Promise.resolve().then(() => this._handleCmd(msg as CmdMsg));
      return;
    }
  }

  private _handleCmd(cmd: CmdMsg): void {
    if (!this.M || !this.ready) return;
    const M = this.M;

    switch (cmd.fn) {
      case 'engine_add_track': {
        const { pcmL, pcmR, numFrames, sampleRate, seq } = cmd as AddTrackMsg;
        const pL = M._malloc(numFrames * 4);
        const pR = pcmR ? M._malloc(numFrames * 4) : 0;

        M.HEAPF32.set(pcmL, pL >> 2);
        if (pcmR) M.HEAPF32.set(pcmR, pR >> 2);

        const id = M._engine_add_track(pL, pR, numFrames, sampleRate);
        // pL/pR ownership transferred to the engine; track_free() will free() them.

        this.onmessage?.({ data: { type: 'track_added', id, seq } });
        break;
      }
      case 'engine_remove_track':       M._engine_remove_track((cmd as IdCmd).id); break;
      case 'engine_set_start_frame':    M._engine_set_start_frame((cmd as StartFrameCmd).id, (cmd as StartFrameCmd).startFrame); break;
      case 'engine_set_gain':           M._engine_set_gain((cmd as ValueCmd).id, (cmd as ValueCmd).value); break;
      case 'engine_set_pan':         M._engine_set_pan((cmd as ValueCmd).id, (cmd as ValueCmd).value); break;
      case 'engine_set_mute':        M._engine_set_mute((cmd as MuteCmd).id, (cmd as MuteCmd).muted ? 1 : 0); break;
      case 'engine_set_solo':        M._engine_set_solo((cmd as SoloCmd).id, (cmd as SoloCmd).soloed ? 1 : 0); break;
      case 'engine_plugin_set_param': {
        const c = cmd as PluginParamCmd;
        M._engine_plugin_set_param(c.id, c.pluginId, c.paramId, c.value);
        break;
      }
      case 'engine_play':            M._engine_play(); break;
      case 'engine_pause':           M._engine_pause(); break;
      case 'engine_seek':            M._engine_seek((cmd as SeekCmd).position); break;
      case 'engine_set_master_gain': M._engine_set_master_gain((cmd as MasterGainCmd).value); break;
    }
  }

  // ── Test helpers (not part of IWorkletPort) ──────────────────────────────

  async ready_(): Promise<void> {
    return this.initPromise;
  }

  processBlock(frames = 128): { L: Float32Array; R: Float32Array } {
    if (!this.M) throw new Error('WASM not loaded');
    const M = this.M;
    const pL = M._malloc(frames * 4);
    const pR = M._malloc(frames * 4);
    M._engine_process(pL, pR, frames);
    const L = M.HEAPF32.slice(pL >> 2, (pL >> 2) + frames);
    const R = M.HEAPF32.slice(pR >> 2, (pR >> 2) + frames);
    M._free(pL);
    M._free(pR);
    return { L, R };
  }

  getPlayhead(): number {
    return this.M?._engine_get_playhead() ?? 0;
  }

  isPlaying(): boolean {
    return (this.M?._engine_is_playing() ?? 0) === 1;
  }
}

// ── Internal message type helpers ─────────────────────────────────────────────

interface CmdMsg          { type: 'cmd'; fn: string }
interface IdCmd           extends CmdMsg { id: number }
interface StartFrameCmd   extends IdCmd  { startFrame: number }
interface ValueCmd        extends IdCmd  { value: number }
interface MuteCmd        extends IdCmd  { muted: boolean }
interface SoloCmd        extends IdCmd  { soloed: boolean }
interface PluginParamCmd extends IdCmd  { pluginId: number; paramId: number; value: number }
interface SeekCmd        extends CmdMsg { position: number }
interface MasterGainCmd  extends CmdMsg { value: number }
interface AddTrackMsg    extends CmdMsg {
  seq: number;
  pcmL: Float32Array;
  pcmR: Float32Array | null;
  numFrames: number;
  sampleRate: number;
}
