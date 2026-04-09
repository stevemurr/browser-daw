// Session.ts — command pattern, undo/redo, JS-side state mirror.
// React and tests interact only with this class; AudioEngine is an impl detail.

import { AudioEngine } from './AudioEngine.js';
import type { DSPPlugin, DSPParam, PluginParamState } from './plugin.js';
export type { Command } from './plugin.js';
import type { SessionState, TrackMirror } from './types.js';
import { PLUGIN_REGISTRY } from './pluginRegistry.js';

// Re-export Command so callers don't need to import plugin.ts directly
import type { Command } from './plugin.js';

// ── Session ───────────────────────────────────────────────────────────────────

export class Session {
  private engine: AudioEngine;
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private tracks = new Map<string, TrackMirror>();
  private masterGain = 1.0;

  private continuous: { description: string } | null = null;
  private subscribers = new Set<(s: SessionState) => void>();

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  // ── Public state ──────────────────────────────────────────────────────────

  getState(): SessionState {
    return {
      tracks:     new Map(this.tracks),
      masterGain: this.masterGain,
      canUndo:    this.undoStack.length > 0,
      canRedo:    this.redoStack.length > 0,
      undoLabel:  this.undoStack.at(-1)?.description ?? null,
      redoLabel:  this.redoStack.at(-1)?.description ?? null,
    };
  }

  subscribe(cb: (s: SessionState) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private notify(): void {
    const state = this.getState();
    for (const cb of this.subscribers) cb(state);
  }

  // ── Command execution ─────────────────────────────────────────────────────

  async execute(cmd: Command): Promise<void> {
    await cmd.execute();
    this.undoStack.push(cmd);
    this.redoStack = [];
    this.notify();
  }

  async undo(): Promise<void> {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    await cmd.undo();
    this.redoStack.push(cmd);
    this.notify();
  }

  async redo(): Promise<void> {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    await cmd.execute();
    this.undoStack.push(cmd);
    this.notify();
  }

  // ── Continuous controls (sliders/knobs) ───────────────────────────────────

  beginContinuous(snapshotCmd: Command): void {
    if (this.continuous) this.continuous = null;
    this.continuous = { description: snapshotCmd.description };
  }

  async commitContinuous(finalCmd: Command): Promise<void> {
    this.continuous = null;
    await this.execute(finalCmd);
  }

  // ── Mirror accessors used by commands ────────────────────────────────────

  slotFor(stableId: string): number {
    const t = this.tracks.get(stableId);
    if (!t) throw new Error(`Unknown stableId: ${stableId}`);
    return t.engineSlot;
  }

  snapshotTrack(stableId: string): TrackMirror {
    const t = this.tracks.get(stableId);
    if (!t) throw new Error(`Unknown stableId: ${stableId}`);
    // Deep-copy the plugins map (two levels)
    const plugins: Record<string, PluginParamState> = {};
    for (const [key, state] of Object.entries(t.plugins)) {
      plugins[key] = { ...state };
    }
    return { ...t, plugins };
  }

  _registerTrack(stableId: string, slot: number, fields: Omit<TrackMirror, 'stableId' | 'engineSlot'>): void {
    this.tracks.set(stableId, { stableId, engineSlot: slot, ...fields });
  }

  _unregisterTrack(stableId: string): void {
    this.tracks.delete(stableId);
  }

  _updateTrack(stableId: string, patch: Partial<TrackMirror>): void {
    const t = this.tracks.get(stableId);
    if (!t) throw new Error(`Unknown stableId: ${stableId}`);
    this.tracks.set(stableId, { ...t, ...patch });
  }

  _updatePluginParam(stableId: string, pluginKey: string, paramId: string, value: number): void {
    const t = this.tracks.get(stableId);
    if (!t) throw new Error(`Unknown stableId: ${stableId}`);
    const plugins = { ...t.plugins, [pluginKey]: { ...t.plugins[pluginKey], [paramId]: value } };
    this.tracks.set(stableId, { ...t, plugins });
  }

  _getPluginParam(stableId: string, pluginKey: string, paramId: string): number {
    const t = this.tracks.get(stableId);
    if (!t) throw new Error(`Unknown stableId: ${stableId}`);
    return t.plugins[pluginKey]?.[paramId] ?? 0;
  }

  _setMasterGain(value: number): void {
    this.masterGain = value;
  }

  getEngine(): AudioEngine { return this.engine; }

  // ── Command factories ─────────────────────────────────────────────────────

  makeAddTrack(
    pcmL: Float32Array, pcmR: Float32Array | null,
    numFrames: number, sampleRate: number,
    name: string,
    stableId = crypto.randomUUID(),
  ): Command {
    return new AddTrackCommand(this, this.engine, pcmL, pcmR, numFrames, sampleRate, name, stableId);
  }

  makeRemoveTrack(stableId: string): Command {
    return new RemoveTrackCommand(this, this.engine, stableId);
  }

  makeSetGain(stableId: string, to: number): Command {
    const from = this.tracks.get(stableId)?.gain ?? 1.0;
    return new SetGainCommand(this, this.engine, stableId, from, to);
  }

  makeSetPan(stableId: string, to: number): Command {
    const from = this.tracks.get(stableId)?.pan ?? 0.0;
    return new SetPanCommand(this, this.engine, stableId, from, to);
  }

  makeSetMute(stableId: string, muted: boolean): Command {
    const from = this.tracks.get(stableId)?.muted ?? false;
    return new SetMuteCommand(this, this.engine, stableId, from, muted);
  }

  makeSetSolo(stableId: string, soloed: boolean): Command {
    const from = this.tracks.get(stableId)?.soloed ?? false;
    return new SetSoloCommand(this, this.engine, stableId, from, soloed);
  }

  /** Generic plugin param command — works for any DSPPlugin registered in PLUGIN_REGISTRY. */
  makeSetPluginParam(stableId: string, plugin: DSPPlugin, paramId: string, to: number): Command {
    const paramDef = plugin.params.find(p => p.id === paramId);
    if (!paramDef) throw new Error(`Unknown param "${paramId}" on plugin "${plugin.pluginKey}"`);
    const from = this._getPluginParam(stableId, plugin.pluginKey, paramId);
    return new SetPluginParamCommand(this, this.engine, stableId, plugin, paramDef, from, to);
  }

  makeSetMasterGain(to: number): Command {
    return new SetMasterGainCommand(this, this.engine, this.masterGain, to);
  }
}

// ── Concrete commands ─────────────────────────────────────────────────────────

/** Builds the initial plugins map for a new track from the registry defaults. */
function buildDefaultPlugins(): Record<string, PluginParamState> {
  const plugins: Record<string, PluginParamState> = {};
  for (const [key, plugin] of PLUGIN_REGISTRY) {
    plugins[key] = plugin.defaultParamState();
  }
  return plugins;
}

class AddTrackCommand implements Command {
  readonly description = 'Add Track';

  constructor(
    private session: Session,
    private engine: AudioEngine,
    private pcmL: Float32Array,
    private pcmR: Float32Array | null,
    private numFrames: number,
    private sampleRate: number,
    private name: string,
    private stableId: string,
  ) {}

  async execute(): Promise<void> {
    const slot = await this.engine.addTrack(this.pcmL, this.pcmR, this.numFrames, this.sampleRate);
    this.session._registerTrack(this.stableId, slot, {
      name:      this.name,
      gain:      1.0,
      pan:       0.0,
      muted:     false,
      soloed:    false,
      plugins:   buildDefaultPlugins(),
      pcmL:      this.pcmL,
      pcmR:      this.pcmR,
      numFrames: this.numFrames,
      sampleRate: this.sampleRate,
    });
  }

  async undo(): Promise<void> {
    const slot = this.session.slotFor(this.stableId);
    this.engine.removeTrack(slot);
    this.session._unregisterTrack(this.stableId);
  }
}

class RemoveTrackCommand implements Command {
  readonly description = 'Remove Track';
  private snapshot: TrackMirror;

  constructor(
    private session: Session,
    private engine: AudioEngine,
    private stableId: string,
  ) {
    this.snapshot = session.snapshotTrack(stableId);
  }

  async execute(): Promise<void> {
    const slot = this.session.slotFor(this.stableId);
    this.engine.removeTrack(slot);
    this.session._unregisterTrack(this.stableId);
  }

  async undo(): Promise<void> {
    const slot = await this.engine.addTrack(
      this.snapshot.pcmL, this.snapshot.pcmR,
      this.snapshot.numFrames, this.snapshot.sampleRate,
    );
    this.session._registerTrack(this.stableId, slot, {
      name:      this.snapshot.name,
      gain:      this.snapshot.gain,
      pan:       this.snapshot.pan,
      muted:     this.snapshot.muted,
      soloed:    this.snapshot.soloed,
      plugins:   this.snapshot.plugins,
      pcmL:      this.snapshot.pcmL,
      pcmR:      this.snapshot.pcmR,
      numFrames: this.snapshot.numFrames,
      sampleRate: this.snapshot.sampleRate,
    });

    // Replay mixer params
    this.engine.setGain(slot, this.snapshot.gain);
    this.engine.setPan(slot, this.snapshot.pan);
    this.engine.setMute(slot, this.snapshot.muted);
    this.engine.setSolo(slot, this.snapshot.soloed);

    // Replay all plugin params generically — no plugin-specific code here
    for (const [pluginKey, paramState] of Object.entries(this.snapshot.plugins)) {
      const pluginDef = PLUGIN_REGISTRY.get(pluginKey);
      if (!pluginDef) continue;
      for (const [paramId, value] of Object.entries(paramState)) {
        const paramDef = pluginDef.params.find(p => p.id === paramId);
        if (!paramDef) continue;
        this.engine.setPluginParam(slot, pluginDef.pluginId, paramDef.cParamId, value);
      }
    }
  }
}

class SetGainCommand implements Command {
  readonly description = 'Set Gain';
  constructor(
    private session: Session, private engine: AudioEngine,
    private stableId: string, private from: number, private to: number,
  ) {}

  async execute(): Promise<void> {
    this.engine.setGain(this.session.slotFor(this.stableId), this.to);
    this.session._updateTrack(this.stableId, { gain: this.to });
  }

  async undo(): Promise<void> {
    this.engine.setGain(this.session.slotFor(this.stableId), this.from);
    this.session._updateTrack(this.stableId, { gain: this.from });
  }
}

class SetPanCommand implements Command {
  readonly description = 'Set Pan';
  constructor(
    private session: Session, private engine: AudioEngine,
    private stableId: string, private from: number, private to: number,
  ) {}

  async execute(): Promise<void> {
    this.engine.setPan(this.session.slotFor(this.stableId), this.to);
    this.session._updateTrack(this.stableId, { pan: this.to });
  }

  async undo(): Promise<void> {
    this.engine.setPan(this.session.slotFor(this.stableId), this.from);
    this.session._updateTrack(this.stableId, { pan: this.from });
  }
}

class SetMuteCommand implements Command {
  readonly description = 'Set Mute';
  constructor(
    private session: Session, private engine: AudioEngine,
    private stableId: string, private from: boolean, private to: boolean,
  ) {}

  async execute(): Promise<void> {
    this.engine.setMute(this.session.slotFor(this.stableId), this.to);
    this.session._updateTrack(this.stableId, { muted: this.to });
  }

  async undo(): Promise<void> {
    this.engine.setMute(this.session.slotFor(this.stableId), this.from);
    this.session._updateTrack(this.stableId, { muted: this.from });
  }
}

class SetSoloCommand implements Command {
  readonly description = 'Set Solo';
  constructor(
    private session: Session, private engine: AudioEngine,
    private stableId: string, private from: boolean, private to: boolean,
  ) {}

  async execute(): Promise<void> {
    this.engine.setSolo(this.session.slotFor(this.stableId), this.to);
    this.session._updateTrack(this.stableId, { soloed: this.to });
  }

  async undo(): Promise<void> {
    this.engine.setSolo(this.session.slotFor(this.stableId), this.from);
    this.session._updateTrack(this.stableId, { soloed: this.from });
  }
}

/** Generic plugin param command — works for any DSPPlugin. */
class SetPluginParamCommand implements Command {
  readonly description: string;

  constructor(
    private session: Session,
    private engine: AudioEngine,
    private stableId: string,
    private plugin: DSPPlugin,
    private param: DSPParam,
    private from: number,
    private to: number,
  ) {
    this.description = `Set ${plugin.pluginKey}.${param.label}`;
  }

  async execute(): Promise<void> {
    const slot = this.session.slotFor(this.stableId);
    this.engine.setPluginParam(slot, this.plugin.pluginId, this.param.cParamId, this.to);
    this.session._updatePluginParam(this.stableId, this.plugin.pluginKey, this.param.id, this.to);
  }

  async undo(): Promise<void> {
    const slot = this.session.slotFor(this.stableId);
    this.engine.setPluginParam(slot, this.plugin.pluginId, this.param.cParamId, this.from);
    this.session._updatePluginParam(this.stableId, this.plugin.pluginKey, this.param.id, this.from);
  }
}

class SetMasterGainCommand implements Command {
  readonly description = 'Set Master Gain';
  constructor(
    private session: Session, private engine: AudioEngine,
    private from: number, private to: number,
  ) {}

  async execute(): Promise<void> {
    this.engine.setMasterGain(this.to);
    this.session._setMasterGain(this.to);
  }

  async undo(): Promise<void> {
    this.engine.setMasterGain(this.from);
    this.session._setMasterGain(this.from);
  }
}
