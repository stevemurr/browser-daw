// daw.ts — Page Object Model for the Browser DAW.
// Abstracts Playwright selectors and window.__daw calls behind a clean API.

import type { Page } from '@playwright/test';

export class DawPage {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  /** Click "Start Audio Engine" and wait until the transport bar appears. */
  async init(): Promise<void> {
    const consoleMsgs: string[] = [];
    const pageErrors: string[] = [];
    this.page.on('console', msg => {
      consoleMsgs.push(`[console.${msg.type()}] ${msg.text()}`);
    });
    this.page.on('pageerror', err => pageErrors.push(err.message));

    await this.goto();
    await this.page.click('button:has-text("Click to Start Audio Engine")');

    // Wait for the transport (success) or an error div (failure).
    const arrived = await Promise.race([
      this.page.waitForSelector('.transport',   { timeout: 20_000 }).then(() => 'ok'  as const),
      this.page.waitForSelector('.init-error',  { timeout: 20_000 }).then(() => 'err' as const),
    ]).catch(() => 'timeout' as const);

    if (arrived === 'err') {
      const errText = await this.page.locator('.init-error').textContent();
      throw new Error(`Audio engine init failed: ${errText}`);
    }
    if (arrived === 'timeout') {
      const log = [...consoleMsgs, ...pageErrors].join('\n') || '(no console output)';
      throw new Error(`Audio engine init timed out after 20 s.\nPage log:\n${log}`);
    }
  }

  /** Inject PCM audio directly into the session (no file drag needed). */
  async injectTrack(
    pcm: number[],
    sampleRate: number,
    name = 'test-track',
  ): Promise<void> {
    await this.page.evaluate(
      ({ pcm, sampleRate, name }) =>
        (window as unknown as Record<string, { injectTrack: (p: number[], sr: number, n: string) => Promise<void> }>)
          .__daw.injectTrack(pcm, sampleRate, name),
      { pcm, sampleRate, name },
    );
    await this.page.waitForSelector('.track-strip');
  }

  async play(): Promise<void> {
    await this.page.click('button:has-text("Play")');
  }

  async pause(): Promise<void> {
    await this.page.click('button:has-text("Pause")');
  }

  /** Capture RMS of the live audio output after `durationMs` milliseconds. */
  async captureRMS(durationMs = 350): Promise<number> {
    return this.page.evaluate(
      (ms) =>
        (window as unknown as Record<string, { captureRMS: (ms: number) => Promise<number> }>)
          .__daw.captureRMS(ms),
      durationMs,
    );
  }

  /** Capture FFT magnitude data (dBFS per bin) after `durationMs` milliseconds. */
  async captureFFT(durationMs = 200): Promise<number[]> {
    return this.page.evaluate(
      (ms) =>
        (window as unknown as Record<string, { captureFFT: (ms: number) => Promise<number[]> }>)
          .__daw.captureFFT(ms),
      durationMs,
    );
  }

  /** Evaluate an expression against the live session object. */
  async evalSession<T>(fn: (session: unknown) => T): Promise<T> {
    return this.page.evaluate(
      (fnSrc) => {
        const s = (window as unknown as Record<string, { session: unknown }>).__daw.session;
        // eslint-disable-next-line no-new-func
        return new Function('session', `return (${fnSrc})(session)`)(s) as T;
      },
      fn.toString(),
    );
  }

  async muteTrack(index = 0): Promise<void> {
    await this.page.locator('.track-strip .btn-mute').nth(index).click();
  }

  async soloTrack(index = 0): Promise<void> {
    await this.page.locator('.track-strip .btn-solo').nth(index).click();
  }

  /** Set a track's gain via the session API (exact, no slider drag needed). */
  async setGain(trackIndex: number, gain: number): Promise<void> {
    await this.page.evaluate(
      ({ idx, gain }) => {
        const session = (window as unknown as Record<string, {
          session: {
            getState: () => { tracks: Map<string, { stableId: string }> };
            execute: (cmd: unknown) => Promise<void>;
            makeSetGain: (id: string, v: number) => unknown;
          };
        }>).__daw.session;
        const tracks = [...session.getState().tracks.values()];
        return session.execute(session.makeSetGain(tracks[idx].stableId, gain));
      },
      { idx: trackIndex, gain },
    );
  }
}
