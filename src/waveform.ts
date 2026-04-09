import type { WaveformPeaks } from './types.js';

export const PEAK_BLOCK_SIZE = 256;

// Number of bins to process before yielding to the event loop.
// 2000 bins × 256 frames ≈ 512k frames ≈ ~2 ms of CPU per chunk at 44100 Hz.
// Keeps every main-thread chunk well under the 50 ms "long task" threshold.
const CHUNK_BINS = 2000;

/**
 * Precompute a peak envelope for fast Canvas waveform rendering.
 * Each bin holds the maximum absolute sample value within a block of
 * PEAK_BLOCK_SIZE frames. O(numFrames) — runs once on track load.
 */
export function computePeaks(
  pcmL: Float32Array,
  pcmR: Float32Array | null,
  numFrames: number,
  blockSize = PEAK_BLOCK_SIZE,
): WaveformPeaks {
  const numBins = Math.ceil(numFrames / blockSize);
  const peaksL = new Float32Array(numBins);
  const peaksR = pcmR ? new Float32Array(numBins) : null;

  for (let bin = 0; bin < numBins; bin++) {
    const start = bin * blockSize;
    const end = Math.min(start + blockSize, numFrames);
    let maxL = 0;
    let maxR = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(pcmL[i]);
      if (a > maxL) maxL = a;
      if (pcmR) {
        const b = Math.abs(pcmR[i]);
        if (b > maxR) maxR = b;
      }
    }
    peaksL[bin] = maxL;
    if (peaksR) peaksR[bin] = maxR;
  }

  return { regionId: '', peaksL, peaksR, blockSize };
}

/**
 * Same as computePeaks but yields to the event loop every CHUNK_BINS bins
 * so the main thread remains responsive during computation. The track header
 * appears immediately; the waveform fills in once this resolves.
 */
export async function computePeaksAsync(
  pcmL: Float32Array,
  pcmR: Float32Array | null,
  numFrames: number,
  blockSize = PEAK_BLOCK_SIZE,
): Promise<WaveformPeaks> {
  const numBins = Math.ceil(numFrames / blockSize);
  const peaksL = new Float32Array(numBins);
  const peaksR = pcmR ? new Float32Array(numBins) : null;

  for (let bin = 0; bin < numBins; bin++) {
    const start = bin * blockSize;
    const end = Math.min(start + blockSize, numFrames);
    let maxL = 0;
    let maxR = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(pcmL[i]);
      if (a > maxL) maxL = a;
      if (pcmR) {
        const b = Math.abs(pcmR[i]);
        if (b > maxR) maxR = b;
      }
    }
    peaksL[bin] = maxL;
    if (peaksR) peaksR[bin] = maxR;

    // Yield to the event loop at the end of each chunk
    if ((bin + 1) % CHUNK_BINS === 0) {
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }

  return { regionId: '', peaksL, peaksR, blockSize };
}
