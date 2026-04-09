import { describe, it, expect } from 'vitest';
import { computePeaks, PEAK_BLOCK_SIZE } from '../src/waveform.js';

describe('computePeaks', () => {
  it('constant PCM produces uniform peak bins equal to that value', () => {
    const pcm = new Float32Array(PEAK_BLOCK_SIZE * 4).fill(0.7);
    const { peaksL } = computePeaks(pcm, null, pcm.length);
    expect(peaksL.every(v => Math.abs(v - 0.7) < 1e-6)).toBe(true);
  });

  it('alternating +1/-1 produces peak = 1.0 in every bin', () => {
    const pcm = new Float32Array(PEAK_BLOCK_SIZE * 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = i % 2 === 0 ? 1.0 : -1.0;
    const { peaksL } = computePeaks(pcm, null, pcm.length);
    expect(peaksL.every(v => Math.abs(v - 1.0) < 1e-6)).toBe(true);
  });

  it('mono input (pcmR = null) → peaksR is null', () => {
    const pcm = new Float32Array(PEAK_BLOCK_SIZE);
    const result = computePeaks(pcm, null, pcm.length);
    expect(result.peaksR).toBeNull();
  });

  it('stereo input computes independent L and R peaks', () => {
    const pcmL = new Float32Array(PEAK_BLOCK_SIZE).fill(0.4);
    const pcmR = new Float32Array(PEAK_BLOCK_SIZE).fill(0.9);
    const result = computePeaks(pcmL, pcmR, pcmL.length);
    expect(Math.abs(result.peaksL[0] - 0.4)).toBeLessThan(1e-6);
    expect(result.peaksR![0]).toBeCloseTo(0.9, 5);
  });

  it('numFrames not divisible by blockSize — last bin covers the partial tail', () => {
    const frames = PEAK_BLOCK_SIZE + 10;
    const pcm = new Float32Array(frames).fill(0.5);
    const { peaksL } = computePeaks(pcm, null, frames);
    expect(peaksL.length).toBe(2); // Math.ceil(frames / PEAK_BLOCK_SIZE) = 2
    expect(Math.abs(peaksL[1] - 0.5)).toBeLessThan(1e-6);
  });

  it('silent PCM produces zero peaks', () => {
    const pcm = new Float32Array(PEAK_BLOCK_SIZE * 3); // all zeros
    const { peaksL } = computePeaks(pcm, null, pcm.length);
    expect(peaksL.every(v => v === 0)).toBe(true);
  });

  it('result blockSize matches the constant', () => {
    const pcm = new Float32Array(PEAK_BLOCK_SIZE);
    const result = computePeaks(pcm, null, pcm.length);
    expect(result.blockSize).toBe(PEAK_BLOCK_SIZE);
  });

  it('regionId is empty string by default (caller sets it)', () => {
    const pcm = new Float32Array(PEAK_BLOCK_SIZE);
    const result = computePeaks(pcm, null, pcm.length);
    expect(result.regionId).toBe('');
  });
});
