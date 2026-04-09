// pluginRegistry.ts — the only file that knows all registered DSP plugins.
// Add new plugins here; nothing else needs to change.

import type { DSPPlugin } from './plugin.js';
import { EQPlugin } from './plugins/eq.plugin.js';

export const PLUGIN_REGISTRY: ReadonlyMap<string, DSPPlugin> = new Map([
  [EQPlugin.pluginKey, EQPlugin],
  // future: [CompressorPlugin.pluginKey, CompressorPlugin],
]);
