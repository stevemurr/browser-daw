# Browser DAW — Spec

## Overview

A browser-based multitrack audio mixer with four layers:

- **C audio engine** compiled to WebAssembly via Emscripten (`engine/`)
- **AudioWorklet** that runs the WASM engine on the dedicated audio thread (`public/worklet.js`)
- **TypeScript wrapper** — `AudioEngine.ts` (postMessage bridge) + `Session.ts` (command pattern, undo/redo, state mirror) + plugin system
- **React frontend** with track strips (fader, pan, mute, solo, EQ) and transport controls

Users drag audio files onto tracks, adjust levels, and play the mix. No recording, no MIDI.

---

## Current Build Status

| Layer | Status |
|---|---|
| C engine (`engine/`) | **Complete** |
| WASM build (`public/audio_engine.js/.wasm`) | **Complete** |
| AudioWorklet (`public/worklet.js`) | **Complete** |
| `AudioEngine.ts` | **Complete** |
| `Session.ts` + plugin system | **Complete** |
| Tests (`make test`) | **Complete** |
| React frontend (`src/components/`) | **Not started** |

---

## Architecture

```
React UI (App, Transport, Mixer, TrackStrip, EQPanel)
    │  subscribes to SessionState; calls session.execute(cmd)
    ▼
Session.ts  — command pattern, undo/redo, Map<stableId, TrackMirror>
    │  calls engine.setGain / engine.addTrack / engine.setPluginParam …
    ▼
AudioEngine.ts  — thin postMessage bridge, IWorkletPort DI
    │  postMessage  ◄──── 'track_added' { seq, id }
    ▼                     'playhead'    { position }
MixerProcessor (public/worklet.js)  — audio thread
    │  calls WASM exports
    ▼
audio_engine.wasm  — C engine compiled by Emscripten
```

---

## Prerequisites

- Node.js 18+ and npm
- Emscripten SDK (`emcc` on PATH)
- Modern browser (Chrome 88+ or Firefox 76+)

---

## C Audio Engine (`engine/`)

### `engine/plugin_ids.h`

```c
#ifndef PLUGIN_IDS_H
#define PLUGIN_IDS_H

/* Plugin IDs (plugin_id argument to engine_plugin_set_param) */
#define PLUGIN_EQ  0
/* future: #define PLUGIN_COMPRESSOR  1 */

/* EQ param IDs (param_id when plugin_id == PLUGIN_EQ) */
#define EQ_PARAM_ENABLED     0   /* global EQ bypass: 0.0=off 1.0=on  */
#define EQ_PARAM_BAND0_FREQ  1   /* Low shelf frequency  (Hz)          */
#define EQ_PARAM_BAND0_GAIN  2   /* Low shelf gain       (dB)          */
#define EQ_PARAM_BAND0_Q     3   /* Low shelf Q                        */
#define EQ_PARAM_BAND1_FREQ  4   /* Mid peak frequency   (Hz)          */
#define EQ_PARAM_BAND1_GAIN  5   /* Mid peak gain        (dB)          */
#define EQ_PARAM_BAND1_Q     6   /* Mid peak Q                         */
#define EQ_PARAM_BAND2_FREQ  7   /* High shelf frequency (Hz)          */
#define EQ_PARAM_BAND2_GAIN  8   /* High shelf gain      (dB)          */
#define EQ_PARAM_BAND2_Q     9   /* High shelf Q                       */

#endif
```

### `engine/eq.h`

```c
#ifndef EQ_H
#define EQ_H

typedef struct {
    float b0, b1, b2, a1, a2;
    float x1, x2, y1, y2;
} Biquad;

typedef enum {
    BAND_LOW_SHELF  = 0,
    BAND_MID_PEAK   = 1,
    BAND_HIGH_SHELF = 2
} BandType;

typedef struct {
    Biquad filters[2]; /* one per channel: L and R */
    float  freq;
    float  gain_db;
    float  q;
    int    enabled;
    BandType type;
} EQBand;

typedef struct {
    EQBand bands[3];
    int    enabled;
} TrackEQ;

void  biquad_set_lowshelf (Biquad* f, float freq, float gain_db, float q, float sr);
void  biquad_set_highshelf(Biquad* f, float freq, float gain_db, float q, float sr);
void  biquad_set_peak     (Biquad* f, float freq, float gain_db, float q, float sr);
float biquad_process      (Biquad* f, float x);
void  biquad_reset        (Biquad* f);

void  eq_init    (TrackEQ* eq, float sample_rate);
void  eq_set_band(TrackEQ* eq, int band, BandType type,
                  float freq, float gain_db, float q, float sample_rate);
float eq_process_sample(TrackEQ* eq, float sample, int channel);

/* Generic param setter — param_id values defined in plugin_ids.h */
void  eq_set_param(TrackEQ* eq, int param_id, float value, float sample_rate);

#endif
```

### `engine/eq.c`

Implements biquad filters using the Audio EQ Cookbook (RBJ) formulas.

`eq_set_param` dispatches on `EQ_PARAM_*` constants:
- `EQ_PARAM_ENABLED` (0): sets `eq->enabled`
- Params 1–9: `band = (param_id-1)/3`, `field = (param_id-1)%3` → freq/gain_db/q; recomputes biquad coefficients

### `engine/track.h`

```c
#ifndef TRACK_H
#define TRACK_H

#include "eq.h"

#define MAX_TRACKS 32

typedef struct {
    float*  pcm_L;
    float*  pcm_R;
    long    num_frames;
    int     active;

    float   gain;         /* 0.0 - 2.0, default 1.0 */
    float   pan;          /* -1.0 (L) to 1.0 (R), default 0.0 */
    int     muted;
    int     soloed;

    TrackEQ eq;
} Track;

void track_init  (Track* t, float sample_rate);
void track_reset (Track* t);
void track_free  (Track* t);

void track_process_frame(Track* t, long playhead,
                         float* out_L, float* out_R);

#endif
```

### `engine/engine.h`

```c
#ifndef ENGINE_H
#define ENGINE_H

/* Track lifecycle */
int  engine_add_track   (float* pcm_L, float* pcm_R,
                         long num_frames, float sample_rate);
void engine_remove_track(int track_id);
int  engine_get_track_count(void);

/* Per-track params */
void engine_set_gain (int track_id, float gain);
void engine_set_pan  (int track_id, float pan);
void engine_set_mute (int track_id, int muted);
void engine_set_solo (int track_id, int soloed);

/* Plugin params — plugin_id and param_id constants in plugin_ids.h */
void engine_plugin_set_param(int track_id, int plugin_id, int param_id, float value);

/* Transport */
void  engine_play         (void);
void  engine_pause        (void);
void  engine_seek         (long sample_position);
long  engine_get_playhead (void);
int   engine_is_playing   (void);

/* Master */
void engine_set_master_gain(float gain);

/* Called from AudioWorklet process() every 128 frames */
void engine_process(float* output_L, float* output_R, int frames);

/* Memory helpers exported to JS */
float* engine_alloc_pcm(long num_frames);
void   engine_free_pcm (float* ptr);

#endif
```

`engine_plugin_set_param` dispatches by `plugin_id`:
- `PLUGIN_EQ` → calls `eq_set_param(&track.eq, param_id, value, g_sample_rate)`

`engine_seek` also resets all biquad filter state on every track to prevent clicks/pops at the new position.

### `engine/build.sh`

Run from inside `engine/`:

```bash
#!/bin/bash
set -e

EXPORTED_FUNCTIONS='[
  "_engine_add_track",
  "_engine_remove_track",
  "_engine_get_track_count",
  "_engine_set_gain",
  "_engine_set_pan",
  "_engine_set_mute",
  "_engine_set_solo",
  "_engine_plugin_set_param",
  "_engine_play",
  "_engine_pause",
  "_engine_seek",
  "_engine_get_playhead",
  "_engine_is_playing",
  "_engine_set_master_gain",
  "_engine_process",
  "_engine_alloc_pcm",
  "_engine_free_pcm",
  "_malloc",
  "_free"
]'

emcc \
  engine.c track.c eq.c \
  -O2 \
  -lm \
  -s WASM=1 \
  -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32","HEAP32","HEAPU8"]' \
  -s INITIAL_MEMORY=67108864 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="AudioEngineModule" \
  -s ENVIRONMENT=web \
  -o ../public/audio_engine.js
```

Key flags:
- `INITIAL_MEMORY=67108864` — fixed 64 MB; avoids dynamic growth complications
- `MODULARIZE=1 / EXPORT_NAME=AudioEngineModule` — worklet loads it as a module
- No `ALLOW_MEMORY_GROWTH` — memory is fixed; worklet only needs `env.emscripten_resize_heap` stubbed

---

## AudioWorklet (`public/worklet.js`)

Served as a static asset from `/public` — **not bundled by Vite**.

Key design points:
- `_initWasm(wasmModule)` — takes only the pre-compiled `WebAssembly.Module`; WASM imports: `{ env: { emscripten_resize_heap: () => 0 } }`
- `seq` field is echoed back in `track_added` reply so `AudioEngine.ts` can resolve the right pending promise when multiple tracks are added concurrently
- PCM is copied into WASM heap (not transferred) — `AudioEngine.ts` uses `.slice()` before postMessage so the command pattern retains originals for undo/redo
- `engine_plugin_set_param` handles all DSP param changes; there are no EQ-specific worklet commands

```javascript
class MixerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false; this.exports = null;
    this.outPtrL = 0; this.outPtrR = 0;

    this.port.onmessage = (e) => {
      if (e.data.type === 'init') this._initWasm(e.data.wasmModule);
      else if (e.data.type === 'cmd') this._handleCmd(e.data);
    };
  }

  _initWasm(wasmModule) {
    const instance = new WebAssembly.Instance(wasmModule, {
      env: { emscripten_resize_heap: () => 0 },
    });
    this.exports = instance.exports;
    this.outPtrL = this.exports.malloc(128 * 4);
    this.outPtrR = this.exports.malloc(128 * 4);
    this.ready = true;
    this.port.postMessage({ type: 'ready' });
  }

  _handleCmd(cmd) {
    if (!this.exports) return;
    const e = this.exports;
    const seq = cmd.seq;   // echoed in responses for promise correlation

    switch (cmd.fn) {
      case 'engine_add_track': {
        const { pcmL, pcmR, numFrames, sampleRate } = cmd;
        const pL = e.malloc(numFrames * 4);
        const pR = pcmR ? e.malloc(numFrames * 4) : 0;
        const heap = new Float32Array(e.memory.buffer);
        heap.set(pcmL, pL >> 2);         // byte ptr >> 2 = float32 index
        if (pcmR) heap.set(pcmR, pR >> 2);
        const id = e.engine_add_track(pL, pR, numFrames, sampleRate);
        e.free(pL); if (pR) e.free(pR);
        this.port.postMessage({ type: 'track_added', id, seq });
        break;
      }
      case 'engine_remove_track':      e.engine_remove_track(cmd.id); break;
      case 'engine_set_gain':          e.engine_set_gain(cmd.id, cmd.value); break;
      case 'engine_set_pan':           e.engine_set_pan(cmd.id, cmd.value); break;
      case 'engine_set_mute':          e.engine_set_mute(cmd.id, cmd.muted ? 1 : 0); break;
      case 'engine_set_solo':          e.engine_set_solo(cmd.id, cmd.soloed ? 1 : 0); break;
      case 'engine_plugin_set_param':
        e.engine_plugin_set_param(cmd.id, cmd.pluginId, cmd.paramId, cmd.value);
        break;
      case 'engine_play':              e.engine_play(); break;
      case 'engine_pause':             e.engine_pause(); break;
      case 'engine_seek':              e.engine_seek(cmd.position); break;
      case 'engine_set_master_gain':   e.engine_set_master_gain(cmd.value); break;
    }
  }

  process(_inputs, outputs) {
    if (!this.ready || !this.exports) {
      outputs[0][0].fill(0); outputs[0][1].fill(0);
      return true;
    }
    const frames = outputs[0][0].length;
    this.exports.engine_process(this.outPtrL, this.outPtrR, frames);
    const heap = new Float32Array(this.exports.memory.buffer);
    outputs[0][0].set(heap.subarray(this.outPtrL >> 2, (this.outPtrL >> 2) + frames));
    outputs[0][1].set(heap.subarray(this.outPtrR >> 2, (this.outPtrR >> 2) + frames));

    // Poll playhead ~100ms (every ~33 process calls at 128 frames / 44100 Hz)
    this._pollCounter = (this._pollCounter || 0) + 1;
    if (this._pollCounter % 33 === 0)
      this.port.postMessage({ type: 'playhead', position: this.exports.engine_get_playhead() });

    return true;
  }
}

registerProcessor('mixer-processor', MixerProcessor);
```

---

## TypeScript Layer

### `src/types.ts`

```typescript
import type { PluginParamState } from './plugin.js';

export interface TrackMirror {
  stableId: string;      // permanent UUID — Session-assigned, survives undo/redo
  engineSlot: number;    // volatile (0-31) — WASM-assigned, may change on redo
  name: string;
  gain: number;          // 0.0 – 2.0
  pan: number;           // -1.0 – 1.0
  muted: boolean;
  soloed: boolean;
  plugins: Record<string, PluginParamState>;  // pluginKey → { paramId → value }
  // Retained PCM for undo/redo of AddTrack/RemoveTrack
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

export interface IWorkletPort {
  postMessage(data: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}
```

### `src/plugin.ts`

```typescript
export interface DSPParam {
  readonly id: string;           // TS key e.g. "band0_freq"
  readonly cParamId: number;     // forwarded as param_id to engine_plugin_set_param
  readonly label: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
}

export interface DSPPlugin {
  readonly pluginId: number;     // C-side PLUGIN_* constant
  readonly pluginKey: string;    // map key in TrackMirror.plugins e.g. "eq"
  readonly params: readonly DSPParam[];
  defaultParamState(): PluginParamState;
}

export type PluginParamState = Record<string, number>;

export interface Command {
  readonly description: string;
  execute(): Promise<void>;
  undo(): Promise<void>;
}
```

### `src/plugins/eq.plugin.ts`

Maps the 10 `EQ_PARAM_*` constants from `plugin_ids.h` to `DSPParam` descriptors:

```typescript
import type { DSPPlugin, DSPParam, PluginParamState } from '../plugin.js';

const eqParams: readonly DSPParam[] = [
  { id: 'enabled',    cParamId: 0, label: 'EQ Enable',       defaultValue: 1,     min: 0,    max: 1,    step: 1 },
  { id: 'band0_freq', cParamId: 1, label: 'Low Shelf Freq',  defaultValue: 80,    min: 20,   max: 2000 },
  { id: 'band0_gain', cParamId: 2, label: 'Low Shelf Gain',  defaultValue: 0,     min: -18,  max: 18 },
  { id: 'band0_q',    cParamId: 3, label: 'Low Shelf Q',     defaultValue: 0.707, min: 0.1,  max: 4 },
  { id: 'band1_freq', cParamId: 4, label: 'Mid Peak Freq',   defaultValue: 1000,  min: 200,  max: 8000 },
  { id: 'band1_gain', cParamId: 5, label: 'Mid Peak Gain',   defaultValue: 0,     min: -18,  max: 18 },
  { id: 'band1_q',    cParamId: 6, label: 'Mid Peak Q',      defaultValue: 0.707, min: 0.1,  max: 4 },
  { id: 'band2_freq', cParamId: 7, label: 'High Shelf Freq', defaultValue: 8000,  min: 2000, max: 20000 },
  { id: 'band2_gain', cParamId: 8, label: 'High Shelf Gain', defaultValue: 0,     min: -18,  max: 18 },
  { id: 'band2_q',    cParamId: 9, label: 'High Shelf Q',    defaultValue: 0.707, min: 0.1,  max: 4 },
];

export const EQPlugin: DSPPlugin = {
  pluginId:  0,   // PLUGIN_EQ
  pluginKey: 'eq',
  params: eqParams,
  defaultParamState(): PluginParamState {
    const s: PluginParamState = {};
    for (const p of eqParams) s[p.id] = p.defaultValue;
    return s;
  },
};
```

### `src/pluginRegistry.ts`

```typescript
import type { DSPPlugin } from './plugin.js';
import { EQPlugin } from './plugins/eq.plugin.js';

export const PLUGIN_REGISTRY: ReadonlyMap<string, DSPPlugin> = new Map([
  [EQPlugin.pluginKey, EQPlugin],
  // future: [CompressorPlugin.pluginKey, CompressorPlugin],
]);
```

### `src/AudioEngine.ts`

Thin postMessage bridge. Has no domain logic — Session owns all state.

Key design:
- Constructor takes `IWorkletPort` (enables `SimulatedWorklet` injection in tests)
- `static create()` factory handles production bootstrap (AudioContext, WASM fetch, worklet load)
- `seq` map correlates concurrent `addTrack` promises — each `addTrack` call gets a unique seq; the worklet echoes it back in `track_added`
- `addTrack` copies PCM with `.slice()` before posting so the Session retains originals for undo/redo

```typescript
export class AudioEngine {
  private port: IWorkletPort;
  private seq = 0;
  private pending = new Map<number, { resolve: (slot: number) => void; reject: (e: Error) => void }>();

  constructor(port: IWorkletPort) {
    this.port = port;
    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  static async create(ctx: AudioContext, wasmUrl: string, workletUrl: string): Promise<AudioEngine> {
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, 'mixer-processor', { numberOfOutputs: 1 });
    node.connect(ctx.destination);

    const wasmBuf = await (await fetch(wasmUrl)).arrayBuffer();
    const wasmMod = await WebAssembly.compile(wasmBuf);

    const engine = new AudioEngine(node.port as unknown as IWorkletPort);
    await new Promise<void>((resolve) => {
      const orig = engine.port.onmessage;
      engine.port.onmessage = (e) => {
        if ((e.data as { type: string }).type === 'ready') {
          engine.port.onmessage = orig; resolve();
        } else { orig?.(e); }
      };
      engine.port.postMessage({ type: 'init', wasmModule: wasmMod });
    });
    return engine;
  }

  private _onMessage(data: unknown): void {
    const msg = data as { type: string; seq?: number; id?: number };
    if (msg.type === 'track_added' && msg.seq !== undefined) {
      const p = this.pending.get(msg.seq);
      if (p) { this.pending.delete(msg.seq); p.resolve(msg.id as number); }
    }
  }

  addTrack(pcmL: Float32Array, pcmR: Float32Array | null, numFrames: number, sampleRate: number): Promise<number> {
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      this.port.postMessage({ type: 'cmd', fn: 'engine_add_track', seq,
        pcmL: pcmL.slice(), pcmR: pcmR ? pcmR.slice() : null, numFrames, sampleRate });
    });
  }

  removeTrack(slot: number): void { this.port.postMessage({ type: 'cmd', fn: 'engine_remove_track', id: slot }); }
  setGain(slot: number, v: number): void { this.port.postMessage({ type: 'cmd', fn: 'engine_set_gain', id: slot, value: v }); }
  setPan(slot: number, v: number): void { this.port.postMessage({ type: 'cmd', fn: 'engine_set_pan', id: slot, value: v }); }
  setMute(slot: number, v: boolean): void { this.port.postMessage({ type: 'cmd', fn: 'engine_set_mute', id: slot, muted: v }); }
  setSolo(slot: number, v: boolean): void { this.port.postMessage({ type: 'cmd', fn: 'engine_set_solo', id: slot, soloed: v }); }
  setPluginParam(slot: number, pluginId: number, cParamId: number, value: number): void {
    this.port.postMessage({ type: 'cmd', fn: 'engine_plugin_set_param', id: slot, pluginId, paramId: cParamId, value });
  }
  setMasterGain(v: number): void { this.port.postMessage({ type: 'cmd', fn: 'engine_set_master_gain', value: v }); }
  play(): void { this.port.postMessage({ type: 'cmd', fn: 'engine_play' }); }
  pause(): void { this.port.postMessage({ type: 'cmd', fn: 'engine_pause' }); }
  seek(position: number): void { this.port.postMessage({ type: 'cmd', fn: 'engine_seek', position }); }
}
```

### `src/Session.ts`

Owns all application state. React and tests interact only with `Session`; `AudioEngine` is an implementation detail.

Key design:
- `execute(cmd)` — runs a command and pushes to undo stack; clears redo stack
- `undo()` / `redo()` — pop respective stack, call `cmd.undo()` / `cmd.execute()`
- `subscribe(cb)` — pub/sub for React; returns unsubscribe function
- `stableId` (UUID) vs `engineSlot` (0-31): stableId is permanent; engineSlot is volatile and may differ after undo/redo of RemoveTrack
- `beginContinuous` / `commitContinuous` — slider workflow: `beginContinuous` marks start, `commitContinuous` pushes one undoable command for the final value

Command factories:

```typescript
session.makeAddTrack(pcmL, pcmR, numFrames, sampleRate, name)
session.makeRemoveTrack(stableId)
session.makeSetGain(stableId, value)
session.makeSetPan(stableId, value)
session.makeSetMute(stableId, muted)
session.makeSetSolo(stableId, soloed)
session.makeSetPluginParam(stableId, plugin, paramId, value)
session.makeSetMasterGain(value)
```

`makeSetPluginParam` is generic — it works for any `DSPPlugin` in the registry without EQ-specific logic. When undone, it calls `engine.setPluginParam(slot, plugin.pluginId, param.cParamId, previousValue)`.

`RemoveTrack` undo replays all plugin params generically by iterating `PLUGIN_REGISTRY` — no plugin-specific code in Session.

---

## React Components

The React layer subscribes to `Session` state. **No component calls `AudioEngine` directly.**

### Bootstrap (in `App.tsx`)

```typescript
// Called on first user gesture (AudioContext requires user interaction)
async function startEngine(): Promise<Session> {
  const ctx = new AudioContext({ sampleRate: 44100 });
  const engine = await AudioEngine.create(ctx, '/audio_engine.wasm', '/worklet.js');
  return new Session(engine);
}
```

### `src/App.tsx`

```tsx
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const initEngine = async () => {
    const s = await startEngine();
    s.subscribe(setState);
    setState(s.getState());
    setSession(s);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!session) return;
    for (const file of Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'))) {
      const buf = await new AudioContext().decodeAudioData(await file.arrayBuffer());
      const pcmL = buf.getChannelData(0);
      const pcmR = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
      await session.execute(session.makeAddTrack(pcmL, pcmR, buf.length, buf.sampleRate, file.name));
    }
  };

  return (
    <div className="app" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
      {!session ? (
        <button className="init-btn" onClick={initEngine}>Click to Start Audio Engine</button>
      ) : (
        <>
          <Transport session={session} state={state!} isPlaying={isPlaying} setIsPlaying={setIsPlaying} />
          <Mixer session={session} state={state!} />
        </>
      )}
    </div>
  );
}
```

### `src/components/Transport.tsx`

Props: `session`, `state: SessionState`, `isPlaying`, `setIsPlaying`.

Responsibilities:
- Play/Pause buttons → `session.getEngine().play()` / `.pause()`
- Playhead display (MM:SS) — updated via `session.getEngine()` playhead callback or a separate subscription
- Undo button (disabled when `!state.canUndo`) → `session.undo()`, label from `state.undoLabel`
- Redo button (disabled when `!state.canRedo`) → `session.redo()`, label from `state.redoLabel`

### `src/components/Mixer.tsx`

Props: `session`, `state: SessionState`.

Renders a `TrackStrip` for each entry in `state.tracks` (iterate `state.tracks.values()`), plus a master fader strip.

Master fader: `session.execute(session.makeSetMasterGain(value))`

### `src/components/TrackStrip.tsx`

Props: `session`, `track: TrackMirror`.

Uses `track.stableId` (not `track.engineSlot`) for all session calls.

- Volume slider:
  - `onMouseDown` → `session.beginContinuous(session.makeSetGain(stableId, currentValue))`
  - `onChange` → `session.getEngine().setGain(track.engineSlot, value)` (live, no undo entry)
  - `onMouseUp` → `session.commitContinuous(session.makeSetGain(stableId, finalValue))`
- Pan slider: same pattern with `makeSetPan`
- Mute button: `session.execute(session.makeSetMute(stableId, !track.muted))`
- Solo button: `session.execute(session.makeSetSolo(stableId, !track.soloed))`
- EQ toggle: local `showEQ` state; renders `<EQPanel>` when open

### `src/components/EQPanel.tsx`

Props: `session`, `track: TrackMirror`.

Reads current values from `track.plugins['eq']` — e.g. `track.plugins['eq']['band0_freq']`.

EQ param changes:
```typescript
import { EQPlugin } from '../plugins/eq.plugin.js';

// On slider commit:
session.execute(session.makeSetPluginParam(track.stableId, EQPlugin, 'band0_freq', value));

// Live (during drag):
session.getEngine().setPluginParam(track.engineSlot, EQPlugin.pluginId, /* cParamId */ 1, value);
```

Bands:
- Band 0: Low Shelf — freq 20–2000 Hz, gain ±18 dB, Q 0.1–4
- Band 1: Mid Peak — freq 200–8000 Hz, gain ±18 dB, Q 0.1–4
- Band 2: High Shelf — freq 2000–20000 Hz, gain ±18 dB, Q 0.1–4

---

## Styles (`src/index.css`)

```css
.app          { display: flex; flex-direction: column; height: 100vh; background: #1a1a1a; color: #e0e0e0; font-family: monospace; }
.init-btn     { margin: auto; padding: 1rem 2rem; font-size: 1.2rem; cursor: pointer; }
.transport    { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1rem; background: #111; border-bottom: 1px solid #333; }
.transport button { padding: 0.4rem 1rem; background: #333; border: 1px solid #555; color: #e0e0e0; cursor: pointer; border-radius: 4px; }
.transport button:hover { background: #444; }
.transport button:disabled { opacity: 0.4; cursor: default; }
.time         { font-size: 1.1rem; letter-spacing: 2px; }
.mixer        { display: flex; flex-direction: row; gap: 2px; padding: 1rem; overflow-x: auto; flex: 1; }
.track-strip  { display: flex; flex-direction: column; gap: 0.4rem; background: #252525; border: 1px solid #333; border-radius: 4px; padding: 0.75rem; min-width: 160px; }
.track-strip.muted  { opacity: 0.5; }
.track-strip.soloed { border-color: #f0c040; }
.track-name   { font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #aaa; margin-bottom: 0.25rem; }
input[type=range] { width: 100%; }
.btn-mute, .btn-solo, .btn-eq { padding: 0.2rem 0.5rem; border: 1px solid #444; background: #333; color: #ccc; cursor: pointer; border-radius: 3px; font-size: 0.75rem; }
.btn-mute.active  { background: #a03030; border-color: #e04040; color: white; }
.btn-solo.active  { background: #806000; border-color: #f0c040; color: white; }
.btn-eq.active    { background: #204060; border-color: #4080c0; color: white; }
.master-strip { background: #1e2a1e; border: 1px solid #3a5a3a; border-radius: 4px; padding: 0.75rem; min-width: 120px; margin-left: auto; }
.eq-panel     { background: #1a1a2e; border: 1px solid #334; border-radius: 4px; padding: 0.5rem; display: flex; flex-direction: column; gap: 0.5rem; }
.eq-band      { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.75rem; }
.eq-band strong { color: #80a0ff; }
.drop-hint    { text-align: center; color: #555; padding: 3rem; font-size: 1.1rem; border: 2px dashed #333; margin: 2rem; border-radius: 8px; }
```

---

## `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

---

## Testing

### C tests — `make test-c`

Native test binaries compiled with clang + Unity framework:
- `engine/test_engine.c` — track lifecycle, gain/pan/mute/solo, plugin params, master gain
- `engine/test_seek.c` — biquad filter reset on seek

Coverage report via `llvm-cov` included in `make test-c` output.

### TypeScript tests — `make test-js` (or `npm test`)

Integration tests via vitest. Tests run headless in Node using `SimulatedWorklet` (in `test/harness/SimulatedWorklet.ts`), which loads the Node WASM build and satisfies the `IWorkletPort` interface without a browser or AudioContext.

```typescript
// Pattern used in test/session.integration.test.ts:
const worklet = new SimulatedWorklet();
await worklet.ready_();
const engine = new AudioEngine(worklet);
const session = new Session(engine);

await session.execute(session.makeAddTrack(pcmL, null, 1024, 44100, 'Track 1'));
// verify state, undo, redo, plugin params, etc.
```

### Run all tests

```bash
make test
```

---

## Known Gotchas

### 1. HEAPF32 pointer arithmetic
All byte pointers from `malloc()` must be shifted right by 2 before indexing into `Float32Array`:
```js
heap.set(float32Array, bytePtr >> 2);
```

### 2. AudioContext must be created after a user gesture
Browsers block `new AudioContext()` until user interaction. The "Click to Start" button pattern is intentional — do not call `AudioEngine.create()` from `useEffect` on mount.

### 3. worklet.js must NOT be Vite-bundled
Load it via `audioContext.audioWorklet.addModule('/worklet.js')` — a URL string, not an import. It lives in `/public` so Vite serves it as-is.

### 4. Synchronous WASM instantiation in the worklet
`WebAssembly.Instance` is synchronous and runs on the audio thread. We compile on the main thread (`WebAssembly.compile`, async), transfer the compiled `Module` (structured-cloneable), then synchronously instantiate in the worklet. Never call `WebAssembly.instantiate()` (the async version) in the worklet.

### 5. Fixed memory — no growth
`build.sh` uses `INITIAL_MEMORY=67108864` (64 MB, fixed). The worklet only stubs `env.emscripten_resize_heap`. If loading very large audio files approaches this limit, increase `INITIAL_MEMORY` and rebuild.

### 6. stableId vs engineSlot in undo/redo
`stableId` is a UUID assigned by Session that never changes. `engineSlot` (0-31) is assigned by the WASM engine and **may differ** after undo/redo of `RemoveTrack` — the engine assigns the first free slot, which may not be the original. Always use `stableId` for session calls; only use `engineSlot` for direct engine calls during live parameter changes.

### 7. tanhf soft clip requires -lm
`engine_process` applies `tanhf()`. Ensure `-lm` is in the `emcc` command — without it, `tanhf` produces NaN at runtime.

### 8. Seek resets all biquad state
`engine_seek` resets all biquad filter history on every track to prevent clicks/pops from stale filter memory bleeding into the new playback position.

---

## Acceptance Criteria

- [ ] `cd engine && ./build.sh` runs without errors → produces `public/audio_engine.js` + `public/audio_engine.wasm`
- [ ] `make test` passes — C unit tests + TypeScript integration tests
- [ ] `npm run dev` starts without errors
- [ ] Clicking "Click to Start Audio Engine" initializes without console errors
- [ ] Dropping a WAV or MP3 file creates a track strip
- [ ] Play/Pause plays and stops audio correctly
- [ ] Gain slider changes volume audibly in real time
- [ ] Pan slider moves audio left/right
- [ ] Mute silences the track; other tracks continue
- [ ] Solo solos the track; all other tracks are silenced
- [ ] Multiple tracks sum correctly
- [ ] EQ band changes are audible (+12 dB low shelf boost on a bass-heavy file is obvious)
- [ ] Master fader changes overall output level
- [ ] Undo/Redo works for: add track, remove track, gain, pan, mute, solo, EQ params, master gain
- [ ] No audio glitches during parameter changes
- [ ] `npm run build` succeeds with no TypeScript errors
