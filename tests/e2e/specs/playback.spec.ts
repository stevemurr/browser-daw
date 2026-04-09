// playback.spec.ts — inject a track, verify play/pause behaviour via RMS capture.

import { test, expect } from '@playwright/test';
import { DawPage } from '../helpers/daw.js';
import { sine } from '../helpers/audio.js';

const SR = 44100;

test.describe('playback', () => {
  test('injecting a track creates a track strip', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();

    const pcm = sine(440, 2, SR, 0.5);
    await daw.injectTrack(pcm, SR, 'sine-440');

    await expect(page.locator('.track-strip')).toBeVisible();
  });

  test('session has one track after inject', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();

    await daw.injectTrack(sine(440, 2, SR, 0.5), SR);

    const count = await daw.evalSession(
      (s) => (s as { getState: () => { tracks: Map<unknown, unknown> } }).getState().tracks.size,
    );
    expect(count).toBe(1);
  });

  test('RMS is non-zero while playing', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    await daw.injectTrack(sine(440, 5, SR, 0.5), SR);

    await daw.play();
    const rms = await daw.captureRMS(400);

    expect(rms).toBeGreaterThan(0.01);
  });

  test('RMS drops to near-zero after pause', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    await daw.injectTrack(sine(440, 5, SR, 0.5), SR);

    await daw.play();
    // Let it run briefly so the engine is definitely producing audio
    await page.waitForTimeout(300);
    await daw.pause();
    // Give the engine a moment to drain
    await page.waitForTimeout(100);

    const rms = await daw.captureRMS(300);
    expect(rms).toBeLessThan(0.01);
  });

  test('FFT shows energy near 440 Hz while playing', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    await daw.injectTrack(sine(440, 5, SR, 0.5), SR);

    await daw.play();
    const fft = await daw.captureFFT(300);

    // FFT bins: bin_i = i * (SR/2) / (fftSize/2)
    // fftSize = 2048, so bin_width = 44100/2048 ≈ 21.5 Hz
    // bin for 440 Hz ≈ 440 / 21.5 ≈ 20
    const binWidth = (SR / 2) / (fft.length);
    const targetBin = Math.round(440 / binWidth);

    // The target bin should be above −40 dBFS (0.5 amplitude sine ≈ −6 dBFS)
    expect(fft[targetBin]).toBeGreaterThan(-40);

    // And clearly louder than DC (bin 0) to confirm spectral content, not noise
    expect(fft[targetBin]).toBeGreaterThan(fft[0] + 10);
  });
});
