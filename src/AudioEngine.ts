// AudioEngine.ts — thin postMessage bridge between Session and the worklet.
// Has no domain logic; Session owns all state and commands.

import type { IWorkletPort } from './types.js';

interface PendingAddTrack {
  resolve: (slot: number) => void;
  reject:  (err: Error) => void;
}

export class AudioEngine {
  private port: IWorkletPort;
  private seq = 0;
  private pending = new Map<number, PendingAddTrack>();
  private onPlayheadCb: ((position: number) => void) | null = null;
  /** Set by AudioEngine.create(). Used only for test instrumentation (tap()). */
  _node: AudioWorkletNode | null = null;

  constructor(port: IWorkletPort) {
    this.port = port;
    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  onPlayheadUpdate(cb: (position: number) => void): void {
    this.onPlayheadCb = cb;
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
    const msg = data as { type: string; seq?: number; id?: number };
    if (msg.type === 'track_added' && msg.seq !== undefined) {
      const pending = this.pending.get(msg.seq);
      if (pending) {
        this.pending.delete(msg.seq);
        pending.resolve(msg.id as number);
      }
    } else if (msg.type === 'playhead') {
      this.onPlayheadCb?.((msg as { type: string; position: number }).position);
    }
  }

  private _nextSeq(): number {
    return ++this.seq;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  // Returns the engine slot assigned by the WASM.
  // Slices pcmL/pcmR so the caller retains the originals for undo/redo,
  // then transfers the slice buffers to avoid a second structured-clone copy
  // in postMessage (which would otherwise serialize hundreds of MB on the main thread).
  addTrack(pcmL: Float32Array, pcmR: Float32Array | null, numFrames: number, sampleRate: number): Promise<number> {
    const seq = this._nextSeq();
    if (import.meta.env.DEV) performance.mark('engine:addTrack-postMessage-start');
    const pcmLCopy = pcmL.slice();
    const pcmRCopy = pcmR ? pcmR.slice() : null;
    const transferList: ArrayBuffer[] = [pcmLCopy.buffer];
    if (pcmRCopy) transferList.push(pcmRCopy.buffer);
    return new Promise<number>((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      this.port.postMessage({
        type: 'cmd', fn: 'engine_add_track',
        seq,
        pcmL: pcmLCopy,
        pcmR: pcmRCopy,
        numFrames,
        sampleRate,
      }, transferList);
      if (import.meta.env.DEV) {
        performance.mark('engine:addTrack-postMessage-end');
        performance.measure('engine:addTrack-postMessage', 'engine:addTrack-postMessage-start', 'engine:addTrack-postMessage-end');
      }
    });
  }

  removeTrack(slot: number): void {
    this.port.postMessage({ type: 'cmd', fn: 'engine_remove_track', id: slot });
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

  play():                    void { this.port.postMessage({ type: 'cmd', fn: 'engine_play' }); }
  pause():                   void { this.port.postMessage({ type: 'cmd', fn: 'engine_pause' }); }
  seek(position: number):    void { this.port.postMessage({ type: 'cmd', fn: 'engine_seek', position }); }
}
