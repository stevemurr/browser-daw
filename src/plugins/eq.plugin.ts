// eq.plugin.ts — EQ plugin descriptor.
// cParamId values must stay in sync with engine/plugin_ids.h EQ_PARAM_* constants.

import type { DSPPlugin, DSPParam, PluginParamState } from '../plugin.js';

const eqParams: readonly DSPParam[] = [
  { id: 'enabled',    cParamId: 0, label: 'EQ Enable',          defaultValue: 1,     min: 0,    max: 1,    step: 1 },
  { id: 'band0_freq', cParamId: 1, label: 'Low Shelf Freq',     defaultValue: 80,    min: 20,   max: 2000 },
  { id: 'band0_gain', cParamId: 2, label: 'Low Shelf Gain',     defaultValue: 0,     min: -18,  max: 18 },
  { id: 'band0_q',    cParamId: 3, label: 'Low Shelf Q',        defaultValue: 0.707, min: 0.1,  max: 4 },
  { id: 'band1_freq', cParamId: 4, label: 'Mid Peak Freq',      defaultValue: 1000,  min: 200,  max: 8000 },
  { id: 'band1_gain', cParamId: 5, label: 'Mid Peak Gain',      defaultValue: 0,     min: -18,  max: 18 },
  { id: 'band1_q',    cParamId: 6, label: 'Mid Peak Q',         defaultValue: 0.707, min: 0.1,  max: 4 },
  { id: 'band2_freq', cParamId: 7, label: 'High Shelf Freq',    defaultValue: 8000,  min: 2000, max: 20000 },
  { id: 'band2_gain', cParamId: 8, label: 'High Shelf Gain',    defaultValue: 0,     min: -18,  max: 18 },
  { id: 'band2_q',    cParamId: 9, label: 'High Shelf Q',       defaultValue: 0.707, min: 0.1,  max: 4 },
];

export const EQPlugin: DSPPlugin = {
  pluginId:  0,   // PLUGIN_EQ in plugin_ids.h
  pluginKey: 'eq',
  params: eqParams,

  defaultParamState(): PluginParamState {
    const state: PluginParamState = {};
    for (const p of eqParams) state[p.id] = p.defaultValue;
    return state;
  },
};
