import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/specs',
  timeout: 30_000,
  retries: 0,
  // Audio tests must run serially — parallel workers fight over the audio graph
  workers: 1,

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },

  use: {
    baseURL: 'http://localhost:5173',
    // Run in headed mode so Chrome's CoreAudio stack is fully initialised.
    // AudioWorklet WASM operations (sync or async) are silently suppressed in
    // Chrome's headless audio thread; headed mode avoids this restriction.
    // --mute-audio prevents any audible output during test runs.
    headless: false,
    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-audio-capture-device',
        '--mute-audio',
      ],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use the user's installed Google Chrome rather than Chrome for Testing
        // (CfT 147) which has stricter AudioWorklet WASM restrictions.
        channel: 'chrome',
      },
    },
  ],
});
