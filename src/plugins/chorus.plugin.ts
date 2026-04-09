import type { DSPPlugin, DSPParam, PluginParamState } from '../plugin.js';

const params: readonly DSPParam[] = [
  { id: 'enabled', cParamId: 0, label: 'Enable', defaultValue: 1,   min: 0,   max: 1,   step: 1 },
  { id: 'rate',    cParamId: 1, label: 'Rate',   defaultValue: 0.5, min: 0.1, max: 5.0 },
  { id: 'depth',   cParamId: 2, label: 'Depth',  defaultValue: 40,  min: 0,   max: 100 },
  { id: 'mix',     cParamId: 3, label: 'Mix',    defaultValue: 0,   min: 0,   max: 100 },
];

export const ChorusPlugin: DSPPlugin = {
  pluginId: 5, pluginKey: 'chorus', params,
  defaultParamState(): PluginParamState {
    const s: PluginParamState = {};
    for (const p of params) s[p.id] = p.defaultValue;
    return s;
  },
};
