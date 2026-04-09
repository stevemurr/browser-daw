// AudioEngine.ts — thin postMessage bridge between Session and the worklet.
// Has no domain logic; Session owns all state and commands.

import type { IWorkletPort } from './types.js';

interface PendingSlot {
  resolve: (slot: number) => void;
  reject:  (err: Error) => void;
}

interface PendingVoid {
  resolve: () => void;
  reject:  (err: Error) => void;
}

interface PendingExport {
  resolve: (data: { outL: Float32Array; outR: Float32Array }) => void;
  reject:  (err: Error) => void;
}

export class AudioEngine {
  private port: IWorkletPort;
  private seq = 0;
  private pendingSlots      = new Map<number, PendingSlot>();
  private pendingChunkLoads = new Map<number, PendingVoid>();
  private pendingExports    = new Map<number, PendingExport>();
  private onPlayheadCb:   ((position: number) => void) | null = null;
  private onWasmHeapCb:   ((bytes: number) => void) | null = null;
  private onChunkNeededCb: ((slot: number, currentChunkEnd: number, kind: 'prefetch' | 'dropout') => void) | null = null;
  private onSeekDoneCb:    ((position: number) => void) | null = null;
  /** Set by AudioEngine.create(). Used only for test instrumentation (tap()). */
  _node: AudioWorkletNode | null = null;

  constructor(port: IWorkletPort) {
    this.port = port;
    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  onPlayheadUpdate(cb: (position: number) => void): void {
    this.onPlayheadCb = cb;
  }

  /** Fires on every playhead tick with the current WASM linear-memory size in bytes. */
  onWasmHeapUpdate(cb: (bytes: number) => void): void {
    this.onWasmHeapCb = cb;
  }

  onChunkNeeded(cb: (slot: number, currentChunkEnd: number, kind: 'prefetch' | 'dropout') => void): void {
    this.onChunkNeededCb = cb;
  }

  onSeekDone(cb: (position: number) => void): void {
    this.onSeekDoneCb = cb;
  }

  /** Connect an AnalyserNode to tap the audio output. Dev/test use only. */
  tap(analyser: AnalyserNode): void {
    this._node?.connect(analyser);
  }

  // ── Factory for production use ──────────────────────────────────────────
  // Loads the WASM binary, registers the worklet module, and wires up the port.
  // Not called in tests — tests use the constructor directly with a SimulatedWorklet.
  static async create(ctx: AudioContext, wasmUrl: string, workletUrl: string): Promise<AudioEngine> {
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, 'mixer-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.connect(ctx.destination);

    const wasmResp = await fetch(wasmUrl);
    const wasmBuf  = await wasmResp.arrayBuffer();

    const engine = new AudioEngine(node.port as unknown as IWorkletPort);
    engine._node = node;

    // In headless Chrome the audio rendering loop only runs while there is
    // active audio demand from the hardware.  Without a continuous source the
    // loop may stop between frames, preventing microtasks (Promise callbacks)
    // from being dispatched on the audio thread, which means
    // WebAssembly.instantiate().then() never fires and "ready" is never sent.
    //
    // Fix: keep a silent oscillator connected to the destination for the
    // duration of WASM init.  The tiny constant output (≈ -100 dBFS) keeps
    // the rendering loop alive without producing audible sound.
    const keepAlive = ctx.createOscillator();
    const keepGain  = ctx.createGain();
    keepGain.gain.setValueAtTime(0.00001, ctx.currentTime);
    keepAlive.connect(keepGain);
    keepGain.connect(ctx.destination);
    keepAlive.start();

    try {
      // ── Step 1: verify message delivery (ping/pong) ──────────────────────
      // If this times out, the audio thread is not receiving messages at all.
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('AudioWorklet ping timed out — audio thread is not processing messages (context.state=' + ctx.state + ')')),
          5_000,
        );
        const prev = engine.port.onmessage;
        engine.port.onmessage = (e: { data: unknown }) => {
          if ((e.data as { type: string }).type === 'pong') {
            clearTimeout(timeout);
            engine.port.onmessage = prev;
            resolve();
          } else {
            prev?.(e);
          }
        };
        engine.port.postMessage({ type: 'ping' });
      });

      // ── Step 2: transfer raw WASM bytes and wait for ready ───────────────────
      // We send the ArrayBuffer (transferable) rather than a pre-compiled
      // WebAssembly.Module because Chrome silently drops postMessage payloads
      // containing a Module when sent to AudioWorklet ports.
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('AudioWorklet timed out — WASM did not instantiate within 10 s')),
          10_000,
        );
        const prev = engine.port.onmessage;
        engine.port.onmessage = (e: { data: unknown }) => {
          const d = e.data as { type: string };
          if (d.type === 'ready') {
            clearTimeout(timeout);
            engine.port.onmessage = prev;
            resolve();
          } else if (d.type === 'error') {
            clearTimeout(timeout);
            reject(new Error(`Worklet WASM error: ${(d as { type: string; message: string }).message}`));
          } else {
            prev?.(e);
          }
        };
        engine.port.postMessage({ type: 'init', wasmBytes: wasmBuf }, [wasmBuf]);
      });
    } finally {
      keepAlive.stop();
      keepAlive.disconnect();
      keepGain.disconnect();
    }

    return engine;
  }

  // ── Message handling ────────────────────────────────────────────────────

  private _onMessage(data: unknown): void {
    const msg = data as { type: string; seq?: number; id?: number; slot?: number };
    if (msg.type === 'track_added_chunked' && msg.seq !== undefined) {
      const pending = this.pendingSlots.get(msg.seq);
      if (pending) {
        this.pendingSlots.delete(msg.seq);
        pending.resolve(msg.slot as number);
      }
    } else if (msg.type === 'chunk_loaded' && msg.seq !== undefined) {
      const pending = this.pendingChunkLoads.get(msg.seq);
      if (pending) {
        this.pendingChunkLoads.delete(msg.seq);
        pending.resolve();
      }
    } else if (msg.type === 'chunk_needed') {
      const d = msg as { type: string; slot: number; currentChunkEnd: number; kind?: 'prefetch' | 'dropout' };
      this.onChunkNeededCb?.(d.slot, d.currentChunkEnd, d.kind ?? 'prefetch');
    } else if (msg.type === 'seek_done') {
      const d = msg as { type: string; position: number };
      this.onSeekDoneCb?.(d.position);
    } else if (msg.type === 'export_complete' && msg.seq !== undefined) {
      const pe = this.pendingExports.get(msg.seq);
      if (pe) {
        this.pendingExports.delete(msg.seq);
        const d = msg as { type: string; seq: number; outL: Float32Array; outR: Float32Array };
        pe.resolve({ outL: d.outL, outR: d.outR });
      }
    } else if (msg.type === 'playhead') {
      const d = msg as { type: string; position: number; wasmHeapBytes?: number };
      this.onPlayheadCb?.(d.position);
      if (d.wasmHeapBytes !== undefined) this.onWasmHeapCb?.(d.wasmHeapBytes);
    }
  }

  private _nextSeq(): number {
    return ++this.seq;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Allocate a WASM track slot for a source file of numFrames total length.
   * No audio data is loaded yet — call loadChunk() (via ChunkCacheManager) to
   * provide the initial chunk before playback starts.
   */
  addTrackChunked(numFrames: number, sampleRate: number): Promise<number> {
    const seq = this._nextSeq();
    return new Promise<number>((resolve, reject) => {
      this.pendingSlots.set(seq, { resolve, reject });
      this.port.postMessage({ type: 'cmd', fn: 'engine_add_track_chunked', seq, numFrames, sampleRate });
    });
  }

  /**
   * Load (or replace) the PCM chunk for `slot`.
   * The arrays are transferred to the worklet (zero-copy); do not reuse them
   * after calling this.  The WASM engine takes ownership and will free them.
   */
  loadChunk(
    slot: number,
    chunkL: Float32Array,
    chunkR: Float32Array | null,
    chunkStart: number,
    chunkLength: number,
  ): Promise<void> {
    const seq      = this._nextSeq();
    const lCopy    = chunkL.slice();
    const rCopy    = chunkR ? chunkR.slice() : null;
    const transfer: ArrayBuffer[] = [lCopy.buffer];
    if (rCopy) transfer.push(rCopy.buffer);
    return new Promise<void>((resolve, reject) => {
      this.pendingChunkLoads.set(seq, { resolve, reject });
      this.port.postMessage({
        type: 'cmd', fn: 'engine_load_chunk',
        seq, slot, chunkL: lCopy, chunkR: rCopy, chunkStart, chunkLength,
      }, transfer);
    });
  }

  removeTrack(slot: number): void {
    this.port.postMessage({ type: 'cmd', fn: 'engine_remove_track', id: slot });
  }

  /** Notify the worklet that a chunk load failed so it can clear its pending state. */
  chunkLoadFailed(slot: number): void {
    this.port.postMessage({ type: 'cmd', fn: 'engine_chunk_load_failed', id: slot });
  }

  setGain(slot: number, value: number): void {
    this.port.postMessage({ type: 'cmd', fn: 'engine_set_gain', id: slot, value });
  }

  setPan(slot: number, value: number): void {
    this.port.postMessage({ type: 'cmd', fn: 'engine_set_pan', id: slot, value });
  }

  setMute(slot: number, muted: boolean): void {
    this.port.postMessage({ type: 'cmd', fn: 'engine_set_mute', id: slot, muted });
  }

  setSolo(slot: number, soloed: boolean): void {
    this.port.postMessage({ type: 'cmd', fn: 'engine_set_solo', id: slot, soloed });
  }

  setPluginParam(slot: number, pluginId: number, cParamId: number, value: number): void {
    this.port.postMessage({ type: 'cmd', fn: 'engine_plugin_set_param', id: slot, pluginId, paramId: cParamId, value });
  }

  setMasterGain(value: number): void {
    this.port.postMessage({ type: 'cmd', fn: 'engine_set_master_gain', value });
  }

  setStartFrame(slot: number, startFrame: number): void {
    this.port.postMessage({ type: 'cmd', fn: 'engine_set_start_frame', id: slot, startFrame });
  }

  play():  void { this.port.postMessage({ type: 'cmd', fn: 'engine_play' }); }
  pause(): void { this.port.postMessage({ type: 'cmd', fn: 'engine_pause' }); }
  seek(position: number): void {
    // The worklet will post `seek_done` after resetting filter state,
    // which triggers ChunkCacheManager to reload chunks around the new position.
    this.port.postMessage({ type: 'cmd', fn: 'engine_seek', position });
  }

  exportRender(totalFrames: number, restorePosition: number): Promise<{ outL: Float32Array; outR: Float32Array }> {
    const seq = this._nextSeq();
    return new Promise((resolve, reject) => {
      this.pendingExports.set(seq, { resolve, reject });
      this.port.postMessage({ type: 'cmd', fn: 'engine_export', seq, totalFrames, restorePosition });
    });
  }
}
