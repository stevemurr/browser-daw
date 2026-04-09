import type { DSPPlugin, DSPParam, PluginParamState } from '../plugin.js';

const params: readonly DSPParam[] = [
  { id: 'enabled', cParamId: 0, label: 'Enable', defaultValue: 1,  min: 0, max: 1,   step: 1 },
  { id: 'preset',  cParamId: 1, label: 'Preset', defaultValue: 0,  min: 0, max: 2,   step: 1 },
  { id: 'mix',     cParamId: 2, label: 'Mix',    defaultValue: 0,  min: 0, max: 100 },
];

export const ReverbPlugin: DSPPlugin = {
  pluginId: 6, pluginKey: 'reverb', params,
  defaultParamState(): PluginParamState {
    const s: PluginParamState = {};
    for (const p of params) s[p.id] = p.defaultValue;
    return s;
  },
};
