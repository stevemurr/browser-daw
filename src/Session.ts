// Session.ts — command pattern, undo/redo, JS-side state mirror.
// React and tests interact only with this class; AudioEngine is an impl detail.

import { AudioEngine } from './AudioEngine.js';
import type { DSPPlugin, DSPParam, PluginParamState } from './plugin.js';
export type { Command } from './plugin.js';
import type { SessionState, TrackMirror, Region, RegionView, WaveformPeaks } from './types.js';
import { PLUGIN_REGISTRY } from './pluginRegistry.js';
import { computePeaks, computePeaksAsync } from './waveform.js';

// Re-export Command so callers don't need to import plugin.ts directly
import type { Command } from './plugin.js';

// ── Session ───────────────────────────────────────────────────────────────────

export class Session {
  private engine: AudioEngine;
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private tracks = new Map<string, TrackMirror>();
  private masterGain = 1.0;
  private regions = new Map<string, Region>();
  private waveformPeaks = new Map<string, WaveformPeaks>(); // keyed by regionId

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
      arrange:    { regions: new Map([...this.regions.entries()].map(([id, r]) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { pcmL, pcmR, ...view } = r;
        return [id, view as RegionView];
      })) },
    };
  }

  subscribe(cb: (s: SessionState) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private notify(): void {
    if (typeof performance !== 'undefined') performance.mark('session:notify-start');
    const state = this.getState();
    for (const cb of this.subscribers) cb(state);
    if (typeof performance !== 'undefined') {
      performance.mark('session:notify-end');
      performance.measure('session:notify', 'session:notify-start', 'session:notify-end');
    }
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

  /** Returns the engineSlot for the first region on this track. Useful for 1:1 track:region models. */
  slotFor(stableId: string): number {
    const regions = this.regionsForTrack(stableId);
    if (regions.length === 0) throw new Error(`No regions for track: ${stableId}`);
    return regions[0].engineSlot;
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

  _getRegion(regionId: string): Region | undefined {
    return this.regions.get(regionId);
  }

  _getTrack(stableId: string): TrackMirror | undefined {
    return this.tracks.get(stableId);
  }

  /** Returns all regions whose trackId === the given stableId. */
  regionsForTrack(trackId: string): Region[] {
    return [...this.regions.values()].filter(r => r.trackId === trackId);
  }

  /** Applies all channel strip settings (gain, pan, mute, solo, plugins) to a C slot. */
  _applyTrackSettings(track: TrackMirror, slot: number): void {
    this.engine.setGain(slot, track.gain);
    this.engine.setPan(slot, track.pan);
    this.engine.setMute(slot, track.muted);
    this.engine.setSolo(slot, track.soloed);
    for (const [pluginKey, paramState] of Object.entries(track.plugins)) {
      const pluginDef = PLUGIN_REGISTRY.get(pluginKey);
      if (!pluginDef) continue;
      for (const [paramId, value] of Object.entries(paramState)) {
        const paramDef = pluginDef.params.find(p => p.id === paramId);
        if (!paramDef) continue;
        this.engine.setPluginParam(slot, pluginDef.pluginId, paramDef.cParamId, value);
      }
    }
  }

  _registerTrack(stableId: string, fields: Omit<TrackMirror, 'stableId'>): void {
    this.tracks.set(stableId, { stableId, ...fields });
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

  _registerRegion(region: Region): void {
    this.regions.set(region.regionId, region);
  }

  _unregisterRegion(regionId: string): void {
    this.regions.delete(regionId);
  }

  _updateRegion(regionId: string, patch: Partial<Region>): void {
    const r = this.regions.get(regionId);
    if (!r) throw new Error(`Unknown regionId: ${regionId}`);
    this.regions.set(regionId, { ...r, ...patch });
  }

  _registerWaveformPeaks(peaks: WaveformPeaks): void {
    this.waveformPeaks.set(peaks.regionId, peaks);
  }

  /** For use by commands that compute peaks asynchronously after execute() returns. */
  _triggerNotify(): void {
    this.notify();
  }

  _unregisterWaveformPeaks(regionId: string): void {
    this.waveformPeaks.delete(regionId);
  }

  getWaveformPeaks(regionId: string): WaveformPeaks | undefined {
    return this.waveformPeaks.get(regionId);
  }

  getEngine(): AudioEngine { return this.engine; }

  // ── Command factories ─────────────────────────────────────────────────────

  makeAddTrack(
    pcmL: Float32Array, pcmR: Float32Array | null,
    numFrames: number, sampleRate: number,
    name: string,
    stableId = crypto.randomUUID(),
    initialStartFrame = 0,
  ): Command {
    return new AddTrackCommand(this, this.engine, pcmL, pcmR, numFrames, sampleRate, name, stableId, initialStartFrame);
  }

  makeMoveRegion(regionId: string, toStartFrame: number, toTrackId?: string): Command {
    const region = this.regions.get(regionId);
    if (!region) throw new Error(`Unknown regionId: ${regionId}`);
    return new MoveRegionCommand(
      this, this.engine, regionId,
      region.startFrame, toStartFrame,
      region.trackId, toTrackId ?? region.trackId,
    );
  }

  makeTrimRegion(regionId: string, newTrimStart: number, newTrimEnd: number): Command {
    const region = this.regions.get(regionId);
    if (!region) throw new Error(`Unknown regionId: ${regionId}`);
    return new TrimRegionCommand(this, this.engine, regionId, region.trimStartFrame, region.trimEndFrame, newTrimStart, newTrimEnd);
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
  private regionId: string;

  constructor(
    private session: Session,
    private engine: AudioEngine,
    private pcmL: Float32Array,
    private pcmR: Float32Array | null,
    private numFrames: number,
    private sampleRate: number,
    private name: string,
    private stableId: string,
    private initialStartFrame: number,
  ) {
    this.regionId = crypto.randomUUID();
  }

  async execute(): Promise<void> {
    const slot = await this.engine.addTrack(this.pcmL, this.pcmR, this.numFrames, this.sampleRate);
    if (this.initialStartFrame !== 0) {
      this.engine.setStartFrame(slot, this.initialStartFrame);
    }
    this.session._registerTrack(this.stableId, {
      name:    this.name,
      gain:    1.0,
      pan:     0.0,
      muted:   false,
      soloed:  false,
      plugins: buildDefaultPlugins(),
    });
    this.session._registerRegion({
      regionId:       this.regionId,
      trackId:        this.stableId,
      startFrame:     this.initialStartFrame,
      trimStartFrame: 0,
      trimEndFrame:   this.numFrames,
      engineSlot:     slot,
      pcmL:           this.pcmL,
      pcmR:           this.pcmR,
      numFrames:      this.numFrames,
      sampleRate:     this.sampleRate,
    });
    // Compute peaks off the critical path: the track appears immediately and the
    // waveform fills in once peaks are ready, keeping the main thread free.
    const regionId = this.regionId;
    const session  = this.session;
    computePeaksAsync(this.pcmL, this.pcmR, this.numFrames).then(peaks => {
      if (!session._getRegion(regionId)) return; // undo was called before peaks finished
      peaks.regionId = regionId;
      session._registerWaveformPeaks(peaks);
      session._triggerNotify();
    });
  }

  async undo(): Promise<void> {
    const region = this.session._getRegion(this.regionId);
    if (!region) throw new Error(`Unknown regionId: ${this.regionId}`);
    this.engine.removeTrack(region.engineSlot);
    this.session._unregisterRegion(this.regionId);
    this.session._unregisterWaveformPeaks(this.regionId);
    this.session._unregisterTrack(this.stableId);
  }
}

class RemoveTrackCommand implements Command {
  readonly description = 'Remove Track';
  private trackSnapshot: TrackMirror;
  private regionSnapshots: Region[];

  constructor(
    private session: Session,
    private engine: AudioEngine,
    private stableId: string,
  ) {
    this.trackSnapshot = session.snapshotTrack(stableId);
    // Shallow-copy each region (PCM arrays are references to immutable typed arrays)
    this.regionSnapshots = session.regionsForTrack(stableId).map(r => ({ ...r }));
  }

  async execute(): Promise<void> {
    for (const region of this.regionSnapshots) {
      this.engine.removeTrack(region.engineSlot);
      this.session._unregisterRegion(region.regionId);
      this.session._unregisterWaveformPeaks(region.regionId);
    }
    this.session._unregisterTrack(this.stableId);
  }

  async undo(): Promise<void> {
    this.session._registerTrack(this.stableId, {
      name:    this.trackSnapshot.name,
      gain:    this.trackSnapshot.gain,
      pan:     this.trackSnapshot.pan,
      muted:   this.trackSnapshot.muted,
      soloed:  this.trackSnapshot.soloed,
      plugins: this.trackSnapshot.plugins,
    });

    for (const regionSnap of this.regionSnapshots) {
      const newSlot = await this.engine.addTrack(
        regionSnap.pcmL, regionSnap.pcmR,
        regionSnap.numFrames, regionSnap.sampleRate,
      );
      this.engine.setStartFrame(newSlot, regionSnap.startFrame);
      this.session._applyTrackSettings(this.trackSnapshot, newSlot);
      this.session._registerRegion({ ...regionSnap, engineSlot: newSlot });
      const regionId = regionSnap.regionId;
      const session  = this.session;
      computePeaksAsync(regionSnap.pcmL, regionSnap.pcmR, regionSnap.numFrames).then(peaks => {
        if (!session._getRegion(regionId)) return;
        peaks.regionId = regionId;
        session._registerWaveformPeaks(peaks);
        session._triggerNotify();
      });
    }
  }
}

class MoveRegionCommand implements Command {
  readonly description = 'Move Region';

  constructor(
    private session: Session,
    private engine: AudioEngine,
    private regionId: string,
    private fromStartFrame: number,
    private toStartFrame: number,
    private fromTrackId: string,
    private toTrackId: string,
  ) {}

  execute(): Promise<void> {
    const region = this.session._getRegion(this.regionId);
    if (!region) throw new Error(`Unknown regionId: ${this.regionId}`);
    this.engine.setStartFrame(region.engineSlot, this.toStartFrame);
    if (this.fromTrackId !== this.toTrackId) {
      const destTrack = this.session._getTrack(this.toTrackId);
      if (destTrack) this.session._applyTrackSettings(destTrack, region.engineSlot);
    }
    this.session._updateRegion(this.regionId, {
      startFrame: this.toStartFrame,
      trackId:    this.toTrackId,
    });
    return Promise.resolve();
  }

  undo(): Promise<void> {
    const region = this.session._getRegion(this.regionId);
    if (!region) throw new Error(`Unknown regionId: ${this.regionId}`);
    this.engine.setStartFrame(region.engineSlot, this.fromStartFrame);
    if (this.fromTrackId !== this.toTrackId) {
      const srcTrack = this.session._getTrack(this.fromTrackId);
      if (srcTrack) this.session._applyTrackSettings(srcTrack, region.engineSlot);
    }
    this.session._updateRegion(this.regionId, {
      startFrame: this.fromStartFrame,
      trackId:    this.fromTrackId,
    });
    return Promise.resolve();
  }
}

class TrimRegionCommand implements Command {
  readonly description = 'Trim Region';
  private regionSnapshot: Region;
  private trackSnapshot: TrackMirror;

  constructor(
    private session: Session,
    private engine: AudioEngine,
    private regionId: string,
    private oldTrimStart: number,
    private oldTrimEnd: number,
    private newTrimStart: number,
    private newTrimEnd: number,
  ) {
    const region = session._getRegion(regionId);
    if (!region) throw new Error(`Unknown regionId: ${regionId}`);
    this.regionSnapshot = { ...region }; // PCM arrays are immutable references
    this.trackSnapshot = session.snapshotTrack(region.trackId);
  }

  async execute(): Promise<void> {
    await this._applyTrim(this.newTrimStart, this.newTrimEnd);
  }

  async undo(): Promise<void> {
    await this._applyTrim(this.oldTrimStart, this.oldTrimEnd);
  }

  private async _applyTrim(trimStart: number, trimEnd: number): Promise<void> {
    // Always read the CURRENT live region for the slot (it changes after each trim)
    const liveRegion = this.session._getRegion(this.regionId);
    if (!liveRegion) throw new Error(`Unknown regionId: ${this.regionId}`);

    // Original PCM is always on regionSnapshot (never mutated)
    const { pcmL, pcmR, sampleRate } = this.regionSnapshot;
    const slicedL = pcmL.subarray(trimStart, trimEnd);
    const slicedR = pcmR ? pcmR.subarray(trimStart, trimEnd) : null;
    const trimmedFrames = trimEnd - trimStart;

    this.engine.removeTrack(liveRegion.engineSlot);
    const newSlot = await this.engine.addTrack(slicedL, slicedR, trimmedFrames, sampleRate);
    this.engine.setStartFrame(newSlot, liveRegion.startFrame);
    this.session._applyTrackSettings(this.trackSnapshot, newSlot);

    this.session._updateRegion(this.regionId, {
      engineSlot:     newSlot,
      trimStartFrame: trimStart,
      trimEndFrame:   trimEnd,
    });
  }
}

class SetGainCommand implements Command {
  readonly description = 'Set Gain';
  constructor(
    private session: Session, private engine: AudioEngine,
    private stableId: string, private from: number, private to: number,
  ) {}

  async execute(): Promise<void> {
    for (const region of this.session.regionsForTrack(this.stableId)) {
      this.engine.setGain(region.engineSlot, this.to);
    }
    this.session._updateTrack(this.stableId, { gain: this.to });
  }

  async undo(): Promise<void> {
    for (const region of this.session.regionsForTrack(this.stableId)) {
      this.engine.setGain(region.engineSlot, this.from);
    }
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
    for (const region of this.session.regionsForTrack(this.stableId)) {
      this.engine.setPan(region.engineSlot, this.to);
    }
    this.session._updateTrack(this.stableId, { pan: this.to });
  }

  async undo(): Promise<void> {
    for (const region of this.session.regionsForTrack(this.stableId)) {
      this.engine.setPan(region.engineSlot, this.from);
    }
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
    for (const region of this.session.regionsForTrack(this.stableId)) {
      this.engine.setMute(region.engineSlot, this.to);
    }
    this.session._updateTrack(this.stableId, { muted: this.to });
  }

  async undo(): Promise<void> {
    for (const region of this.session.regionsForTrack(this.stableId)) {
      this.engine.setMute(region.engineSlot, this.from);
    }
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
    for (const region of this.session.regionsForTrack(this.stableId)) {
      this.engine.setSolo(region.engineSlot, this.to);
    }
    this.session._updateTrack(this.stableId, { soloed: this.to });
  }

  async undo(): Promise<void> {
    for (const region of this.session.regionsForTrack(this.stableId)) {
      this.engine.setSolo(region.engineSlot, this.from);
    }
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
    for (const region of this.session.regionsForTrack(this.stableId)) {
      this.engine.setPluginParam(region.engineSlot, this.plugin.pluginId, this.param.cParamId, this.to);
    }
    this.session._updatePluginParam(this.stableId, this.plugin.pluginKey, this.param.id, this.to);
  }

  async undo(): Promise<void> {
    for (const region of this.session.regionsForTrack(this.stableId)) {
      this.engine.setPluginParam(region.engineSlot, this.plugin.pluginId, this.param.cParamId, this.from);
    }
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
