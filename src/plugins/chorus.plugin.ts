import type { DSPPlugin, DSPParam, PluginParamState } from '../plugin.js';

const params: readonly DSPParam[] = [
  { id: 'enabled', cParamId: 0, label: 'Enable', defaultValue: 1,  min: 0, max: 1,   step: 1 },
  { id: 'size',    cParamId: 4, label: 'Size',   defaultValue: 50, min: 0, max: 100 },
  { id: 'mix',     cParamId: 3, label: 'Mix',    defaultValue: 0,  min: 0, max: 100 },
];

export const ChorusPlugin: DSPPlugin = {
  pluginId: 5, pluginKey: 'chorus', params,
  defaultParamState(): PluginParamState {
    const s: PluginParamState = {};
    for (const p of params) s[p.id] = p.defaultValue;
    return s;
  },
};
