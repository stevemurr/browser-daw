// limiter.plugin.ts — Peak brickwall limiter descriptor.
// cParamId values must stay in sync with engine/plugin_ids.h LIM_PARAM_* constants.

import type { DSPPlugin, DSPParam, PluginParamState } from '../plugin.js';

const params: readonly DSPParam[] = [
  { id: 'enabled',   cParamId: 0, label: 'Enable',    defaultValue: 1,    min: 0,   max: 1,   step: 1 },
  { id: 'threshold', cParamId: 1, label: 'Threshold', defaultValue: -0.3, min: -24, max: 0 },
  { id: 'release',   cParamId: 2, label: 'Release',   defaultValue: 100,  min: 10,  max: 500 },
];

export const LimiterPlugin: DSPPlugin = {
  pluginId:  3,   // PLUGIN_LIMITER in plugin_ids.h
  pluginKey: 'limiter',
  params,

  defaultParamState(): PluginParamState {
    const s: PluginParamState = {};
    for (const p of params) s[p.id] = p.defaultValue;
    return s;
  },
};
