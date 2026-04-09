// pluginRegistry.ts — the only file that knows all registered DSP plugins.
// Add new plugins here; nothing else needs to change.

import type { DSPPlugin } from './plugin.js';
import { EQPlugin } from './plugins/eq.plugin.js';
import { CompressorPlugin } from './plugins/compressor.plugin.js';
import { DistortionPlugin } from './plugins/distortion.plugin.js';
import { LimiterPlugin } from './plugins/limiter.plugin.js';
import { DelayPlugin } from './plugins/delay.plugin.js';
import { ChorusPlugin } from './plugins/chorus.plugin.js';
import { ReverbPlugin } from './plugins/reverb.plugin.js';

export const PLUGIN_REGISTRY: ReadonlyMap<string, DSPPlugin> = new Map([
  [EQPlugin.pluginKey,         EQPlugin],
  [CompressorPlugin.pluginKey, CompressorPlugin],
  [DistortionPlugin.pluginKey, DistortionPlugin],
  [LimiterPlugin.pluginKey,    LimiterPlugin],
  [DelayPlugin.pluginKey,      DelayPlugin],
  [ChorusPlugin.pluginKey,     ChorusPlugin],
  [ReverbPlugin.pluginKey,     ReverbPlugin],
]);
