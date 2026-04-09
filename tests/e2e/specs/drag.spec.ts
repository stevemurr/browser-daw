// drag.spec.ts — cross-track region drag: correctness and timing budgets.

import { test, expect } from '@playwright/test';
import { DawPage } from '../helpers/daw.js';
import { sine } from '../helpers/audio.js';

const SR = 44100;

test.describe('cross-track region drag', () => {
  test('region moves to destination track after cross-track drag', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    const pcm = sine(440, 1, SR, 0.5);
    await daw.injectTrack(pcm, SR, 'Track A');
    await daw.injectTrack(pcm, SR, 'Track B');

    // Capture the regionId and original trackId for the first region
    const before = await daw.evalSession(s => {
      const state = (s as any).getState();
      const [region] = [...state.arrange.regions.values()];
      return { regionId: region.regionId as string, trackId: region.trackId as string };
    });

    await daw.dragRegion(0, 1);

    // Wait for the region's trackId to change in session state
    await page.waitForFunction(
      ({ regionId, originalTrackId }) => {
        const state = (window as any).__daw.session.getState();
        const region = state.arrange.regions.get(regionId);
        return region != null && region.trackId !== originalTrackId;
      },
      { regionId: before.regionId, originalTrackId: before.trackId },
      { timeout: 3000 },
    );

    // Verify: some region now lives on a track other than the original
    const movedRegionTrackId = await daw.evalSession(s => {
      const state = (s as any).getState();
      const region = state.arrange.regions.get(
        [...state.arrange.regions.keys()][0]
      ) as any;
      return region?.trackId ?? null;
    });
    expect(movedRegionTrackId).not.toBeNull();
    expect(movedRegionTrackId).not.toBe(before.trackId);
  });

  test('canvas draw stays within 30 ms budget for a 1-second clip', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    const pcm = sine(440, 1, SR, 0.5);
    await daw.injectTrack(pcm, SR, 'Track A');
    await daw.injectTrack(pcm, SR, 'Track B');

    // Clear any measures accumulated during init/inject
    await page.evaluate(() => performance.clearMeasures());

    await daw.dragRegion(0, 1);

    // Allow React to commit the render triggered by session.execute()
    await page.waitForTimeout(200);

    const measures = await page.evaluate(() =>
      performance.getEntriesByName('canvas:draw').map(m => m.duration)
    );

    expect(measures.length).toBeGreaterThan(0);
    const maxCanvasDraw = Math.max(...measures);
    // 1-second clip at default zoom ≈ 220px → should be well under 30 ms
    expect(maxCanvasDraw).toBeLessThan(30);
  });

  test('drag commit completes within 200 ms', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    const pcm = sine(440, 1, SR, 0.5);
    await daw.injectTrack(pcm, SR, 'Track A');
    await daw.injectTrack(pcm, SR, 'Track B');

    await page.evaluate(() => performance.clearMeasures());

    await daw.dragRegion(0, 1);
    await page.waitForTimeout(200);

    const measures = await page.evaluate(() =>
      performance.getEntriesByName('drag:commit').map(m => m.duration)
    );

    expect(measures.length).toBeGreaterThan(0);
    expect(measures[0]).toBeLessThan(200);
  });
});
