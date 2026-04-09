import { useState, useEffect, useRef } from 'react';
import type { Session } from '../Session.js';
import type { TrackMirror } from '../types.js';
import { EQPlugin } from '../plugins/eq.plugin.js';

interface Props {
  session: Session;
  track: TrackMirror;
}

const BANDS = [
  { label: 'Low Shelf',  freqId: 'band0_freq', gainId: 'band0_gain', qId: 'band0_q', freqMin: 20,   freqMax: 2000  },
  { label: 'Mid Peak',   freqId: 'band1_freq', gainId: 'band1_gain', qId: 'band1_q', freqMin: 200,  freqMax: 8000  },
  { label: 'High Shelf', freqId: 'band2_freq', gainId: 'band2_gain', qId: 'band2_q', freqMin: 2000, freqMax: 20000 },
] as const;

export function EQPanel({ session, track }: Props) {
  const eq = track.plugins['eq'] ?? {};
  const dragging = useRef<Record<string, boolean>>({});

  // Local state mirrors eq plugin params while dragging
  const [local, setLocal] = useState<Record<string, number>>(() => ({ ...eq }));

  useEffect(() => {
    // Sync from mirror when not dragging any param
    setLocal(prev => {
      const next = { ...prev };
      for (const key of Object.keys(eq)) {
        if (!dragging.current[key]) next[key] = eq[key];
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.plugins]);

  const get = (id: string): number => local[id] ?? (eq[id] ?? 0);

  const handleChange = (paramId: string, value: number) => {
    const param = EQPlugin.params.find(p => p.id === paramId)!;
    setLocal(prev => ({ ...prev, [paramId]: value }));
    for (const r of session.regionsForTrack(track.stableId)) {
      session.getEngine().setPluginParam(r.engineSlot, EQPlugin.pluginId, param.cParamId, value);
    }
  };

  const handleCommit = (paramId: string, value: number) => {
    dragging.current[paramId] = false;
    session.execute(session.makeSetPluginParam(track.stableId, EQPlugin, paramId, value));
  };

  const eqEnabled = get('enabled') >= 0.5;

  return (
    <div className="eq-panel">
      <div className="btn-row">
        <button
          className={`btn-eq${eqEnabled ? ' active' : ''}`}
          onClick={() => {
            const next = eqEnabled ? 0 : 1;
            session.execute(session.makeSetPluginParam(track.stableId, EQPlugin, 'enabled', next));
          }}
        >
          EQ {eqEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {BANDS.map(band => (
        <div key={band.label} className="eq-band">
          <div className="eq-band-label">{band.label}</div>

          <div className="param-row">
            <label>Freq</label>
            <input
              type="range"
              min={band.freqMin} max={band.freqMax} step={1}
              value={get(band.freqId)}
              onMouseDown={() => { dragging.current[band.freqId] = true; }}
              onChange={e => handleChange(band.freqId, parseFloat(e.target.value))}
              onMouseUp={e => handleCommit(band.freqId, parseFloat((e.target as HTMLInputElement).value))}
            />
            <span>{Math.round(get(band.freqId))}Hz</span>
          </div>

          <div className="param-row">
            <label>Gain</label>
            <input
              type="range"
              min={-18} max={18} step={0.5}
              value={get(band.gainId)}
              onMouseDown={() => { dragging.current[band.gainId] = true; }}
              onChange={e => handleChange(band.gainId, parseFloat(e.target.value))}
              onMouseUp={e => handleCommit(band.gainId, parseFloat((e.target as HTMLInputElement).value))}
            />
            <span>{get(band.gainId) > 0 ? '+' : ''}{get(band.gainId).toFixed(1)}dB</span>
          </div>

          <div className="param-row">
            <label>Q</label>
            <input
              type="range"
              min={0.1} max={4} step={0.1}
              value={get(band.qId)}
              onMouseDown={() => { dragging.current[band.qId] = true; }}
              onChange={e => handleChange(band.qId, parseFloat(e.target.value))}
              onMouseUp={e => handleCommit(band.qId, parseFloat((e.target as HTMLInputElement).value))}
            />
            <span>{get(band.qId).toFixed(1)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
