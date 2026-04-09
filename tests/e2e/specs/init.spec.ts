// init.spec.ts — verify audio engine bootstrap and initial session state.

import { test, expect } from '@playwright/test';
import { DawPage } from '../helpers/daw.js';

test.describe('engine initialisation', () => {
  test('page loads without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const daw = new DawPage(page);
    await daw.init();

    expect(errors).toHaveLength(0);
  });

  test('transport bar is visible after start', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();
    await expect(page.locator('.transport')).toBeVisible();
  });

  test('session is accessible via __daw hook', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();

    const hasSession = await page.evaluate(
      () => !!(window as unknown as Record<string, unknown>).__daw,
    );
    expect(hasSession).toBe(true);
  });

  test('session starts with no tracks', async ({ page }) => {
    const daw = new DawPage(page);
    await daw.init();

    const trackCount = await daw.evalSession(
      (s) => (s as { getState: () => { tracks: Map<unknown, unknown> } }).getState().tracks.size,
    );
    expect(trackCount).toBe(0);
  });
});
