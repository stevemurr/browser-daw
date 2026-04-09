import { useState, useCallback, useRef } from 'react';
import { AudioEngine } from './AudioEngine.js';
import { Session } from './Session.js';
import { OPFSAudioFileStore } from './store/AudioFileStore.js';
import { ChunkCacheManager } from './ChunkCacheManager.js';
import type { SessionState } from './types.js';
import { Transport } from './components/Transport.js';
import { ArrangeView } from './components/ArrangeView.js';
import { useKeyboard } from './hooks/useKeyboard.js';
import { MemoryPanel } from './components/MemoryPanel.js';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [initError, setInitError] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const chunksRef = useRef<ChunkCacheManager | null>(null);
  const storeRef  = useRef<OPFSAudioFileStore | null>(null);
  // Stable ref so keyboard handlers always have the latest values without re-subscribing
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const initEngine = useCallback(async () => {
    setInitError(null);
    const ctx = new AudioContext({ sampleRate: 44100 });
    await ctx.resume();
    ctxRef.current = ctx;
    const engine = await AudioEngine.create(ctx, '/audio_engine.wasm', '/worklet.js');
    engine.onPlayheadUpdate(setPlayhead);
    const store   = new OPFSAudioFileStore();
    const chunks  = new ChunkCacheManager(engine, store);
    engineRef.current = engine;
    chunksRef.current = chunks;
    storeRef.current  = store;
    const s = new Session(engine, store, chunks);
    s.subscribe(setState);
    setState(s.getState());
    setSession(s);

    if (import.meta.env.DEV) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      engine.tap(analyser);
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      analyser.connect(silentGain);
      silentGain.connect(ctx.destination);

      (window as unknown as Record<string, unknown>).__daw = {
        session: s,
        engine,
        ctx,
        analyser,
        chunks,
        /** Print chunk streaming event log to the console (call after reproducing an issue). */
        chunkLog() { chunks.printLog(); },
        /** Clear the chunk streaming event log. */
        chunkClear() { chunks.clearLog(); },
        /** Return current slot metadata snapshot (pending state, trim bounds, etc.). */
        chunkState() { return chunks.getSlotState(); },
        /** Return the raw event array for custom filtering/analysis. */
        chunkEvents() { return chunks.getEventLog(); },
        async injectTrack(pcm: number[], sampleRate: number, name: string): Promise<void> {
          const pcmL   = new Float32Array(pcm);
          const fileId = crypto.randomUUID();
          await s.getStore().store(fileId, pcmL, null, { fileId, name, numFrames: pcmL.length, sampleRate, numChannels: 1 });
          return s.execute(s.makeAddTrack(fileId, name, pcmL.length, sampleRate));
        },
        captureRMS(durationMs: number): Promise<number> {
          return new Promise(resolve => setTimeout(() => {
            const buf = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(buf);
            const rms = Math.sqrt(buf.reduce((sum, x) => sum + x * x, 0) / buf.length);
            resolve(rms);
          }, durationMs));
        },
        captureFFT(durationMs: number): Promise<number[]> {
          return new Promise(resolve => setTimeout(() => {
            const buf = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatFrequencyData(buf);
            resolve(Array.from(buf));
          }, durationMs));
        },
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInitClick = useCallback(() => {
    initEngine().catch((err: unknown) => {
      setInitError(err instanceof Error ? err.message : String(err));
    });
  }, [initEngine]);

  const handlePlay = useCallback(() => {
    if (!session) return;
    ctxRef.current?.resume();
    session.getEngine().play();
    setIsPlaying(true);
  }, [session]);

  const handlePause = useCallback(() => {
    if (!session) return;
    session.getEngine().pause();
    setIsPlaying(false);
  }, [session]);

  const handleSeek = useCallback((pos: number) => {
    session?.getEngine().seek(pos);
  }, [session]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useKeyboard({
    ' ': () => {
      if (!sessionRef.current) return;
      if (isPlayingRef.current) {
        sessionRef.current.getEngine().pause();
        setIsPlaying(false);
      } else {
        ctxRef.current?.resume();
        sessionRef.current.getEngine().play();
        setIsPlaying(true);
      }
    },
  });

  return (
    <div className="app">
      {!session ? (
        <>
          <button className="init-btn" onClick={handleInitClick}>
            Click to Start Audio Engine
          </button>
          {initError && (
            <div className="init-error" role="alert">{initError}</div>
          )}
        </>
      ) : (
        <>
          <Transport
            session={session}
            state={state!}
            isPlaying={isPlaying}
            playhead={playhead}
            onPlay={handlePlay}
            onPause={handlePause}
            onSeek={handleSeek}
          />
          <ArrangeView
            session={session}
            state={state!}
            playhead={playhead}
            onSeek={handleSeek}
            audioContext={ctxRef.current}
          />
          {import.meta.env.DEV && engineRef.current && chunksRef.current && storeRef.current && (
            <MemoryPanel
              engine={engineRef.current}
              chunks={chunksRef.current}
              store={storeRef.current}
            />
          )}
        </>
      )}
    </div>
  );
}
