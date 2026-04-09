import { useState, useCallback, useRef } from 'react';
import { AudioEngine } from './AudioEngine.js';
import { Session } from './Session.js';
import type { SessionState } from './types.js';
import { Transport } from './components/Transport.js';
import { Mixer } from './components/Mixer.js';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [initError, setInitError] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const initEngine = useCallback(async () => {
    setInitError(null);
    const ctx = new AudioContext({ sampleRate: 44100 });
    await ctx.resume();
    ctxRef.current = ctx;
    const engine = await AudioEngine.create(ctx, '/audio_engine.wasm', '/worklet.js');
    engine.onPlayheadUpdate(setPlayhead);
    const s = new Session(engine);
    s.subscribe(setState);
    setState(s.getState());
    setSession(s);

    if (import.meta.env.DEV) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      // Tap worklet output into analyser; route through silent gain so the
      // analyser is pulled by the audio graph without doubling the output level.
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
        injectTrack(pcm: number[], sampleRate: number, name: string): Promise<void> {
          const pcmL = new Float32Array(pcm);
          return s.execute(s.makeAddTrack(pcmL, null, pcmL.length, sampleRate, name));
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

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    if (!session || !ctxRef.current) return;
    const ctx = ctxRef.current;
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
    for (const file of files) {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      const pcmL = buf.getChannelData(0);
      const pcmR = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
      await session.execute(
        session.makeAddTrack(pcmL, pcmR, buf.length, buf.sampleRate, file.name)
      );
    }
  }, [session]);

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

  return (
    <div
      className="app"
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
    >
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
          <Mixer session={session} state={state!} />
          {state!.tracks.size === 0 && (
            <div className="drop-hint">Drop audio files here to add tracks</div>
          )}
        </>
      )}
    </div>
  );
}
