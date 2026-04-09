// public/worklet.js
// Runs on the dedicated audio thread.
// Receives raw WASM bytes from the main thread via postMessage (transferred
// as an ArrayBuffer) then compiles and instantiates them asynchronously.
//
// Import contract (Emscripten 5, ALLOW_MEMORY_GROWTH=1):
//   WASM imports:  env.emscripten_resize_heap  (calls memory.grow())
//   WASM exports:  memory, malloc, free, engine_*

class MixerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready    = false;
    this.exports  = null;
    this.outPtrL  = 0;
    this.outPtrR  = 0;

    this.port.onmessage = (e) => {
      const t = e.data ? e.data.type : '?';
      if (t === 'ping') {
        this.port.postMessage({ type: 'pong' });
      } else if (t === 'init') {
        // Production path: AudioEngine sends raw bytes (ArrayBuffer) to avoid
        // Chrome's silent-drop of WebAssembly.Module objects on AudioWorklet ports.
        // Test path: harness sends a pre-compiled WebAssembly.Module for efficiency.
        this._initWasm(e.data.wasmModule ?? e.data.wasmBytes);
      } else if (t === 'cmd') {
        this._handleCmd(e.data);
      }
    };
  }

  async _initWasm(wasmData) {
    try {
      // heapMemory is set after instantiation so the stub can call memory.grow().
      // emscripten_resize_heap(requested_size) is called by malloc when it needs
      // to expand the heap; returning 1 means success, 0 means OOM.
      let heapMemory = null;
      const imports = {
        env: {
          emscripten_resize_heap: (requested_size) => {
            if (!heapMemory) return 0;
            const cur   = heapMemory.buffer.byteLength;
            const delta = Math.ceil((requested_size - cur) / 65536);
            if (delta <= 0) return 1;
            try { heapMemory.grow(delta); return 1; }
            catch { return 0; }
          },
        },
      };
      const result = await WebAssembly.instantiate(wasmData, imports);
      // instantiate returns a WebAssembly.Instance when given a compiled Module,
      // or { module, instance } when given raw bytes.
      const instance = result instanceof WebAssembly.Instance ? result : result.instance;
      heapMemory   = instance.exports.memory; // wire up the resize stub
      this.exports = instance.exports;
      this.outPtrL = this.exports.malloc(128 * 4);
      this.outPtrR = this.exports.malloc(128 * 4);
      this.ready   = true;
      this.port.postMessage({ type: 'ready' });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }

  _handleCmd(cmd) {
    if (!this.exports) return;
    const e = this.exports;
    // seq is echoed back in any response so the main thread can correlate.
    const seq = cmd.seq;

    switch (cmd.fn) {
      case 'engine_add_track': {
        const { pcmL, pcmR, numFrames, sampleRate } = cmd;

        const pL = e.malloc(numFrames * 4);
        const pR = pcmR ? e.malloc(numFrames * 4) : 0;

        const heap = new Float32Array(e.memory.buffer);
        heap.set(pcmL, pL >> 2);
        if (pcmR) heap.set(pcmR, pR >> 2);

        if (pL === 0) {
          // malloc returned NULL — heap could not grow (OOM).
          this.port.postMessage({ type: 'error', message: 'OOM: malloc failed for PCM buffer', seq });
          if (pR) e.free(pR);
          break;
        }

        const id = e.engine_add_track(pL, pR, numFrames, sampleRate);
        // pL / pR ownership transferred to the engine.
        // track_free() (called by engine_remove_track) will free() them.

        // Echo seq so AudioEngine can resolve the right pending promise.
        this.port.postMessage({ type: 'track_added', id, seq });
        break;
      }
      case 'engine_remove_track':    e.engine_remove_track(cmd.id); break;
      case 'engine_set_gain':        e.engine_set_gain(cmd.id, cmd.value); break;
      case 'engine_set_pan':         e.engine_set_pan(cmd.id, cmd.value); break;
      case 'engine_set_mute':        e.engine_set_mute(cmd.id, cmd.muted ? 1 : 0); break;
      case 'engine_set_solo':        e.engine_set_solo(cmd.id, cmd.soloed ? 1 : 0); break;
      case 'engine_plugin_set_param':
        e.engine_plugin_set_param(cmd.id, cmd.pluginId, cmd.paramId, cmd.value);
        break;
      case 'engine_set_start_frame': e.engine_set_start_frame(cmd.id, cmd.startFrame); break;
      case 'engine_play':            e.engine_play(); break;
      case 'engine_pause':           e.engine_pause(); break;
      case 'engine_seek':            e.engine_seek(cmd.position); break;
      case 'engine_set_master_gain': e.engine_set_master_gain(cmd.value); break;

      case 'engine_export': {
        // Render the mix offline, synchronously, on the audio thread.
        // This blocks process() for the duration but is safe — no concurrent access.
        const { totalFrames, restorePosition, seq } = cmd;
        const CHUNK = 4096;

        const chunkPtrL = e.malloc(CHUNK * 4);
        const chunkPtrR = e.malloc(CHUNK * 4);

        const outL = new Float32Array(totalFrames);
        const outR = new Float32Array(totalFrames);

        // Capture pre-export state
        const wasPlaying = !!e.engine_is_playing();
        e.engine_seek(0);
        e.engine_play();
        this.exporting = true;

        let written = 0;
        while (written < totalFrames) {
          const n = Math.min(CHUNK, totalFrames - written);
          e.engine_process(chunkPtrL, chunkPtrR, n);
          const heap = new Float32Array(e.memory.buffer);
          outL.set(heap.subarray(chunkPtrL >> 2, (chunkPtrL >> 2) + n), written);
          outR.set(heap.subarray(chunkPtrR >> 2, (chunkPtrR >> 2) + n), written);
          written += n;
        }

        this.exporting = false;
        e.engine_pause();
        e.engine_seek(restorePosition ?? 0);
        if (wasPlaying) e.engine_play();

        e.free(chunkPtrL);
        e.free(chunkPtrR);

        this.port.postMessage(
          { type: 'export_complete', seq, outL, outR },
          [outL.buffer, outR.buffer],
        );
        break;
      }
    }
  }

  process(_inputs, outputs) {
    if (!this.ready || !this.exports) {
      outputs[0][0].fill(0);
      outputs[0][1].fill(0);
      return true;
    }

    const frames = outputs[0][0].length;
    this.exports.engine_process(this.outPtrL, this.outPtrR, frames);

    const heap = new Float32Array(this.exports.memory.buffer);
    const L = heap.subarray(this.outPtrL >> 2, (this.outPtrL >> 2) + frames);
    const R = heap.subarray(this.outPtrR >> 2, (this.outPtrR >> 2) + frames);

    outputs[0][0].set(L);
    outputs[0][1].set(R);

    this._pollCounter = (this._pollCounter || 0) + 1;
    if (this._pollCounter % 33 === 0) {
      this.port.postMessage({
        type: 'playhead',
        position: this.exports.engine_get_playhead(),
      });
    }

    return true;
  }
}

registerProcessor('mixer-processor', MixerProcessor);
