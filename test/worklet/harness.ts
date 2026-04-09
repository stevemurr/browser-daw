// harness.ts — runs worklet.js inside a Node vm context so its logic can be
// tested without a browser.  All built-ins (Float32Array, Promise, …) come from
// the outer Node context so arrays are instanceof-compatible with test code.

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const workletSrc = readFileSync(path.join(__dir, '../../public/worklet.js'), 'utf8');

// ── Mock port ────────────────────────────────────────────────────────────────

export interface MockPort {
  /** Set by the worklet constructor. */
  onmessage: ((e: { data: unknown }) => void) | null;
  /** Messages sent OUT by the processor (track_added, ready, playhead, …). */
  sent: unknown[];
  /** Send a message IN to the processor (init, cmd). */
  deliver(data: unknown): void;
  /** Await the next outbound message matching `type`. */
  nextMessage(type: string, timeoutMs?: number): Promise<unknown>;
}

function makeMockPort(): MockPort {
  const port: MockPort = {
    onmessage: null,
    sent: [],
    deliver(data: unknown) {
      port.onmessage?.({ data });
    },
    nextMessage(type: string, timeoutMs = 5000): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const deadline = setTimeout(
          () => reject(new Error(`Timeout: no '${type}' message within ${timeoutMs}ms`)),
          timeoutMs,
        );
        const orig = (port as unknown as { postMessage: (d: unknown) => void }).postMessage;
        (port as unknown as { postMessage: (d: unknown) => void }).postMessage = function (data: unknown) {
          orig.call(port, data);
          if ((data as { type?: string }).type === type) {
            clearTimeout(deadline);
            (port as unknown as { postMessage: (d: unknown) => void }).postMessage = orig;
            resolve(data);
          }
        };
      });
    },
  };

  // postMessage is used by the processor; cast is intentional — we expose it
  // as part of the mock shape via nextMessage().
  (port as unknown as { postMessage: (d: unknown) => void }).postMessage = function (data: unknown) {
    port.sent.push(data);
  };

  return port;
}

// ── vm context ───────────────────────────────────────────────────────────────

let ProcessorClass: new () => ProcessorInstance;

// Pass outer-context Float32Array + WebAssembly so that typed arrays created
// inside the vm are instanceof-compatible with test code.
const vmCtx = vm.createContext({
  Float32Array,
  ArrayBuffer,
  WebAssembly,
  Promise,
  console,
  currentTime: 0,
  sampleRate: 44100,

  AudioWorkletProcessor: class AudioWorkletProcessor {
    port = makeMockPort();
  },

  registerProcessor(_name: string, cls: new () => ProcessorInstance) {
    ProcessorClass = cls;
  },
});

vm.runInContext(workletSrc, vmCtx);

// ── Public factory ───────────────────────────────────────────────────────────

export interface ProcessorInstance {
  port: MockPort;
  ready: boolean;
  exports: unknown;
  _initWasm(mod: WebAssembly.Module): void;
  _handleCmd(cmd: unknown): void;
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
}

export function makeProcessor(): ProcessorInstance {
  if (!ProcessorClass) throw new Error('registerProcessor was never called — worklet.js not loaded?');
  return new ProcessorClass();
}
