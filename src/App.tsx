import { useState, useCallback, useRef } from 'react';
import { AudioEngine } from './AudioEngine.js';
import { Session } from './Session.js';
import { OPFSAudioFileStore } from './store/AudioFileStore.js';
import { ChunkCacheManager } from './ChunkCacheManager.js';
import type { SessionState } from './types.js';
import { Transport } from './components/Transport.js';
import { ArrangeView } from './components/ArrangeView.js';
import { useKeyboard } from './hooks/useKeyboard.js';
import { useSessionAutoSave } from './hooks/useSessionAutoSave.js';
import { MemoryPanel } from './components/MemoryPanel.js';
import {
  listSessions, loadSession, saveSession, deleteSession,
  getMostRecentSessionId, generateDefaultName, restoreSession,
  type SessionListItem,
} from './store/SessionStore.js';

export default function App() {
  const [session, setSession]     = useState<Session | null>(null);
  const [state, setState]         = useState<SessionState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead]   = useState(0);
  const [initError, setInitError] = useState<string | null>(null);

  // Session identity state (for rendering)
  const [sessionId, setSessionId]             = useState<string | null>(null);
  const [sessionName, setSessionName]         = useState('');
  const [sessionCreatedAt, setSessionCreatedAt] = useState<number | null>(null);
  const [sessionList, setSessionList]         = useState<SessionListItem[]>([]);

  const ctxRef    = useRef<AudioContext | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const chunksRef = useRef<ChunkCacheManager | null>(null);
  const storeRef  = useRef<OPFSAudioFileStore | null>(null);

  // Stable refs so callbacks always see current values without stale closures
  const isPlayingRef    = useRef(isPlaying);
  const sessionRef      = useRef(session);
  const sessionIdRef    = useRef(sessionId);
  const sessionNameRef  = useRef(sessionName);
  const sessionCreatedAtRef = useRef(sessionCreatedAt);

  isPlayingRef.current       = isPlaying;
  sessionRef.current         = session;
  sessionIdRef.current       = sessionId;
  sessionNameRef.current     = sessionName;
  sessionCreatedAtRef.current = sessionCreatedAt;

  // Auto-save on every session state change (debounced 500ms)
  useSessionAutoSave(session, sessionId, sessionName, sessionCreatedAt);

  // ── Internal helpers ───────────────────────────────────────────────────────

  async function _activateSession(s: Session, id: string, name: string, createdAt: number) {
    s.subscribe(setState);
    setState(s.getState());
    setSession(s);
    setSessionId(id);
    setSessionName(name);
    setSessionCreatedAt(createdAt);
    setSessionList(await listSessions());
  }

  // ── Engine init ────────────────────────────────────────────────────────────

  const initEngine = useCallback(async () => {
    setInitError(null);
    const ctx = new AudioContext({ sampleRate: 44100 });
    await ctx.resume();
    ctxRef.current = ctx;

    const engine = await AudioEngine.create(ctx, '/audio_engine.wasm', '/worklet.js');
    engine.onPlayheadUpdate(setPlayhead);

    const store  = new OPFSAudioFileStore();
    const chunks = new ChunkCacheManager(engine, store);
    engineRef.current = engine;
    chunksRef.current = chunks;
    storeRef.current  = store;

    // Try to restore the most-recently saved session; fall back to a new one
    const sessions = await listSessions();
    let s: Session;
    let id: string;
    let name: string;
    let createdAt: number;

    if (sessions.length > 0) {
      const latestId = await getMostRecentSessionId();
      const saved    = latestId ? await loadSession(latestId) : null;
      if (saved) {
        s         = await restoreSession(saved, engine, chunks, store);
        id        = saved.sessionId;
        name      = saved.name;
        createdAt = saved.createdAt;
      } else {
        s         = new Session(engine, store, chunks);
        id        = crypto.randomUUID();
        name      = generateDefaultName(sessions);
        createdAt = Date.now();
      }
    } else {
      s         = new Session(engine, store, chunks);
      id        = crypto.randomUUID();
      name      = generateDefaultName([]);
      createdAt = Date.now();
    }

    await _activateSession(s, id, name, createdAt);

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
        chunkLog()    { chunks.printLog(); },
        chunkClear()  { chunks.clearLog(); },
        chunkState()  { return chunks.getSlotState(); },
        chunkEvents() { return chunks.getEventLog(); },
        async injectTrack(pcm: number[], sr: number, trackName: string): Promise<void> {
          const pcmL   = new Float32Array(pcm);
          const fileId = crypto.randomUUID();
          await s.getStore().store(fileId, pcmL, null, { fileId, name: trackName, numFrames: pcmL.length, sampleRate: sr, numChannels: 1 });
          return s.execute(s.makeAddTrack(fileId, trackName, pcmL.length, sr));
        },
        captureRMS(durationMs: number): Promise<number> {
          return new Promise(resolve => setTimeout(() => {
            const buf = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(buf);
            resolve(Math.sqrt(buf.reduce((sum, x) => sum + x * x, 0) / buf.length));
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

  // ── Playback ───────────────────────────────────────────────────────────────

  const handleInitClick = useCallback(() => {
    initEngine().catch((err: unknown) => {
      setInitError(err instanceof Error ? err.message : String(err));
    });
  }, [initEngine]);

  const handlePlay = useCallback(() => {
    if (!sessionRef.current) return;
    ctxRef.current?.resume();
    sessionRef.current.getEngine().play();
    setIsPlaying(true);
  }, []);

  const handlePause = useCallback(() => {
    if (!sessionRef.current) return;
    sessionRef.current.getEngine().pause();
    setIsPlaying(false);
  }, []);

  const handleSeek = useCallback((pos: number) => {
    sessionRef.current?.getEngine().seek(pos);
  }, []);

  // ── Session management ─────────────────────────────────────────────────────

  const handleSwitchSession = useCallback(async (id: string) => {
    const sess   = sessionRef.current;
    const engine = engineRef.current;
    const chunks = chunksRef.current;
    const store  = storeRef.current;
    if (!engine || !chunks || !store) return;

    // Flush the current session to IndexedDB before switching
    if (sess && sessionIdRef.current && sessionNameRef.current) {
      await saveSession(
        sess.serialize(sessionIdRef.current, sessionNameRef.current, sessionCreatedAtRef.current ?? undefined),
      ).catch(err => console.error('[App] switch: save error', err));
      sess.unloadSession();
    }

    const saved = await loadSession(id);
    if (!saved) return;
    const next = await restoreSession(saved, engine, chunks, store);
    await _activateSession(next, saved.sessionId, saved.name, saved.createdAt);
    setIsPlaying(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateSession = useCallback(async () => {
    const sess   = sessionRef.current;
    const engine = engineRef.current;
    const chunks = chunksRef.current;
    const store  = storeRef.current;
    if (!engine || !chunks || !store) return;

    // Save + unload current session
    if (sess && sessionIdRef.current && sessionNameRef.current) {
      await saveSession(
        sess.serialize(sessionIdRef.current, sessionNameRef.current, sessionCreatedAtRef.current ?? undefined),
      ).catch(err => console.error('[App] create: save error', err));
      sess.unloadSession();
    }

    const current    = await listSessions();
    const newId        = crypto.randomUUID();
    const newName      = generateDefaultName(current);
    const newCreatedAt = Date.now();
    const next         = new Session(engine, store, chunks);

    await _activateSession(next, newId, newName, newCreatedAt);
    setIsPlaying(false);

    // Persist the new empty session so it appears in other tabs / on next load
    await saveSession(next.serialize(newId, newName, newCreatedAt));
    setSessionList(await listSessions());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRenameSession = useCallback(async (id: string, name: string) => {
    const sess = sessionRef.current;
    if (!sess || id !== sessionIdRef.current) return;
    setSessionName(name);
    await saveSession(
      sess.serialize(id, name, sessionCreatedAtRef.current ?? undefined),
    ).catch(err => console.error('[App] rename: save error', err));
    setSessionList(await listSessions());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeleteSession = useCallback(async (id: string) => {
    const engine = engineRef.current;
    const chunks = chunksRef.current;
    const store  = storeRef.current;
    if (!store) return;

    // Collect fileIds exclusively owned by the session being deleted
    const toDelete = await loadSession(id);
    if (!toDelete) { await deleteSession(id); setSessionList(await listSessions()); return; }

    const deletedFileIds = new Set(
      toDelete.tracks.flatMap(t => t.regions.map(r => r.fileId)),
    );

    // Find files shared with other sessions
    const remaining = (await listSessions()).filter(s => s.sessionId !== id);
    const sharedIds = new Set<string>();
    for (const item of remaining) {
      const other = await loadSession(item.sessionId);
      if (other) {
        for (const t of other.tracks) for (const r of t.regions) sharedIds.add(r.fileId);
      }
    }

    // Delete OPFS files not referenced by any remaining session
    for (const fileId of deletedFileIds) {
      if (!sharedIds.has(fileId)) {
        await store.delete(fileId).catch(err => console.error('[App] delete file error:', err));
      }
    }

    await deleteSession(id);

    if (id === sessionIdRef.current) {
      // We deleted the active session — switch to another or create empty
      if (remaining.length > 0) {
        await handleSwitchSession(remaining[0].sessionId);
      } else if (engine && chunks) {
        sessionRef.current?.unloadSession();
        const newId        = crypto.randomUUID();
        const newCreatedAt = Date.now();
        const next         = new Session(engine, store, chunks);
        await _activateSession(next, newId, 'Session 1', newCreatedAt);
        await saveSession(next.serialize(newId, 'Session 1', newCreatedAt));
        setSessionList(await listSessions());
        setIsPlaying(false);
      }
    } else {
      setSessionList(await listSessions());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSwitchSession]);

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

  // ── Render ─────────────────────────────────────────────────────────────────

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
            sessionId={sessionId}
            sessionName={sessionName}
            sessions={sessionList}
            onSwitchSession={handleSwitchSession}
            onCreateSession={handleCreateSession}
            onRenameSession={handleRenameSession}
            onDeleteSession={handleDeleteSession}
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
