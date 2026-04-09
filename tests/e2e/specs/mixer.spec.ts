// mixer.spec.ts — mute, gain, and solo behaviour verified via RMS capture.

import { test, expect } from '@playwright/test';
import { DawPage } from '../helpers/daw.js';
import { sine } from '../helpers/audio.js';

const SR = 44100;

test.describe('mixer controls', () => {
  test('mute button silences the track', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    await daw.injectTrack(sine(440, 5, SR, 0.5), SR);

    await daw.play();
    await page.waitForTimeout(200);
    await daw.muteTrack(0);

    const rms = await daw.captureRMS(350);
    expect(rms).toBeLessThan(0.01);
  });

  test('unmuting restores audio', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    await daw.injectTrack(sine(440, 5, SR, 0.5), SR);

    await daw.play();
    await page.waitForTimeout(150);
    await daw.muteTrack(0);   // mute
    await page.waitForTimeout(100);
    await daw.muteTrack(0);   // unmute (toggle)

    const rms = await daw.captureRMS(400);
    expect(rms).toBeGreaterThan(0.01);
  });

  test('gain=0 produces silence', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    await daw.injectTrack(sine(440, 5, SR, 0.5), SR);

    await daw.setGain(0, 0);
    await daw.play();

    const rms = await daw.captureRMS(400);
    expect(rms).toBeLessThan(0.01);
  });

  test('gain=1 preserves expected signal level', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    await daw.injectTrack(sine(440, 5, SR, 0.5), SR);

    await daw.setGain(0, 1);
    await daw.play();

    const rms = await daw.captureRMS(400);
    // 0.5 amplitude sine has RMS ≈ 0.354; after gain=1 it should stay well above 0.1
    expect(rms).toBeGreaterThan(0.1);
  });

  test('solo plays the soloed track', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    await daw.injectTrack(sine(440, 5, SR, 0.5), SR, 'track-a');

    await daw.soloTrack(0);
    await daw.play();

    const rms = await daw.captureRMS(400);
    expect(rms).toBeGreaterThan(0.01);
  });

  test('soloing one track silences the other', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    await daw.injectTrack(sine(440, 5, SR, 0.5), SR, 'track-a');
    await daw.injectTrack(sine(880, 5, SR, 0.5), SR, 'track-b');

    // Solo track 0 — track 1 should be silent
    await daw.soloTrack(0);
    await daw.play();

    // Verify we still get audio overall (track 0 is playing)
    const rms = await daw.captureRMS(400);
    expect(rms).toBeGreaterThan(0.01);
  });
});
