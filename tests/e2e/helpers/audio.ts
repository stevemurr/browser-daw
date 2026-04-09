/** Generate a sine wave as a plain number[] (serialisable over page.evaluate). */
export function sine(freq: number, durationSec: number, sampleRate: number, amplitude = 0.5): number[] {
  const frames = Math.floor(durationSec * sampleRate);
  const out: number[] = new Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amplitude * Math.sin(2 * Math.PI * freq * i / sampleRate);
  }
  return out;
}

/** DC signal — useful for verifiable gain/EQ arithmetic. */
export function dc(value: number, durationSec: number, sampleRate: number): number[] {
  return new Array(Math.floor(durationSec * sampleRate)).fill(value);
}
