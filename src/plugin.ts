// plugin.ts — pure data interfaces for the DSP plugin system.
// No imports from Session or AudioEngine; plugins are descriptors, not behaviors.

/** One knob / toggle exposed by a DSP plugin. */
export interface DSPParam {
  readonly id: string;           // TS-side string key e.g. "band0_freq"
  readonly cParamId: number;     // integer forwarded to engine_plugin_set_param
  readonly label: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;        // omit for continuous
}

/** Static descriptor for one DSP plugin type.
 *  All DSP lives in C at compile time; this object is pure TS metadata. */
export interface DSPPlugin {
  readonly pluginId: number;     // C-side plugin_id (matches plugin_ids.h PLUGIN_* constants)
  readonly pluginKey: string;    // map key used in TrackMirror.plugins e.g. "eq"
  readonly params: readonly DSPParam[];

  /** Initial param state for a newly created track. */
  defaultParamState(): PluginParamState;
}

/** Runtime state for one plugin instance on one track (JS-side mirror).
 *  Keys are DSPParam.id strings; values are the current parameter values. */
export type PluginParamState = Record<string, number>;

// ── Command interface (here to keep plugin.ts the low-coupling leaf module) ──

export interface Command {
  readonly description: string;
  execute(): Promise<void>;
  undo(): Promise<void>;
}
