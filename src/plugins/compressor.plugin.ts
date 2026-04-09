// compressor.plugin.ts — LA-2A-style optical compressor descriptor.
// cParamId values must stay in sync with engine/plugin_ids.h COMP_PARAM_* constants.

import type { DSPPlugin, DSPParam, PluginParamState } from '../plugin.js';

const compressorParams: readonly DSPParam[] = [
  { id: 'enabled', cParamId: 0, label: 'Enable',  defaultValue: 1,  min: 0, max: 1,   step: 1 },
  { id: 'amount',  cParamId: 1, label: 'Amount',  defaultValue: 0,  min: 0, max: 100 },
];

export const CompressorPlugin: DSPPlugin = {
  pluginId:  1,   // PLUGIN_COMPRESSOR in plugin_ids.h
  pluginKey: 'compressor',
  params: compressorParams,

  defaultParamState(): PluginParamState {
    const state: PluginParamState = {};
    for (const p of compressorParams) state[p.id] = p.defaultValue;
    return state;
  },
};
