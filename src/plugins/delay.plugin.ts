// delay.plugin.ts — stereo delay descriptor.
// cParamId values must stay in sync with engine/plugin_ids.h DELAY_PARAM_* constants.

import type { DSPPlugin, DSPParam, PluginParamState } from '../plugin.js';

const params: readonly DSPParam[] = [
  { id: 'enabled',  cParamId: 0, label: 'Enable',   defaultValue: 1,   min: 0,  max: 1,    step: 1 },
  { id: 'time_ms',  cParamId: 1, label: 'Time',     defaultValue: 250, min: 1,  max: 2000 },
  { id: 'feedback', cParamId: 2, label: 'Feedback', defaultValue: 35,  min: 0,  max: 95 },
  { id: 'mix',      cParamId: 3, label: 'Mix',      defaultValue: 0,   min: 0,  max: 100 },
];

export const DelayPlugin: DSPPlugin = {
  pluginId:  4,   // PLUGIN_DELAY in plugin_ids.h
  pluginKey: 'delay',
  params,

  defaultParamState(): PluginParamState {
    const s: PluginParamState = {};
    for (const p of params) s[p.id] = p.defaultValue;
    return s;
  },
};
