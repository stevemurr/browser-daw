// distortion.plugin.ts — waveshaping distortion descriptor.
// cParamId values must stay in sync with engine/plugin_ids.h DIST_PARAM_* constants.

import type { DSPPlugin, DSPParam, PluginParamState } from '../plugin.js';

const params: readonly DSPParam[] = [
  { id: 'enabled', cParamId: 0, label: 'Enable', defaultValue: 1,   min: 0, max: 1,   step: 1 },
  { id: 'drive',   cParamId: 1, label: 'Drive',  defaultValue: 0,   min: 0, max: 100 },
  { id: 'mode',    cParamId: 2, label: 'Mode',   defaultValue: 0,   min: 0, max: 2,   step: 1 },
  { id: 'mix',     cParamId: 3, label: 'Mix',    defaultValue: 100, min: 0, max: 100 },
];

export const DistortionPlugin: DSPPlugin = {
  pluginId:  2,   // PLUGIN_DISTORTION in plugin_ids.h
  pluginKey: 'distortion',
  params,

  defaultParamState(): PluginParamState {
    const s: PluginParamState = {};
    for (const p of params) s[p.id] = p.defaultValue;
    return s;
  },
};
