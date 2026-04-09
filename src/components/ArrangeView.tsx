import { useState, useRef, useEffect, useCallback } from 'react';
import type { Session } from '../Session.js';
import type { SessionState, RegionView, WaveformPeaks } from '../types.js';
import { computePeaksAsync } from '../waveform.js';
import { Ruler } from './Ruler.js';
import { TrackLane } from './TrackLane.js';
import { TrackHeader } from './TrackHeader.js';

const TRACK_HEADER_WIDTH = 180;

interface Viewport {
  scrollX: number;
  pxPerFrame: number;
  trackHeight: number;
}

type DragMode =
  | {
      kind: 'move';
      regionId: string;
      startX: number;
      startY: number;
      originalStartFrame: number;
      originalTrackId: string;
      currentStartFrame: number;
      currentTrackId: string;
    }
  | { kind: 'trim-left'; regionId: string; startX: number; origTrimStart: number; origTrimEnd: number; currentTrimStart: number }
  | { kind: 'trim-right'; regionId: string; startX: number; origTrimStart: number; origTrimEnd: number; currentTrimEnd: number }
  | null;

interface ArrangeViewProps {
  session: Session;
  state: SessionState;
  playhead: number;
  onSeek: (frame: number) => void;
  audioContext: AudioContext | null;
}

export function ArrangeView({ session, state, playhead, onSeek, audioContext }: ArrangeViewProps) {
  const [viewport, setViewport] = useState<Viewport>({
    scrollX: 0,
    pxPerFrame: 0.005,
    trackHeight: 80,
  });
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const laneAreaRef = useRef<HTMLDivElement>(null);
  const lanesContainerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode>(null);
  const rafRef = useRef<number | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  // Stable refs so event handlers always read fresh values without re-subscribing
  const stateRef = useRef(state);
  stateRef.current = state;
  const tracksRef = useRef(state ? [...state.tracks.values()] : []);
  tracksRef.current = state ? [...state.tracks.values()] : [];
  // Current playhead in frames — updated on every render without causing handleDrop to re-subscribe.
  const playheadPosRef = useRef(playhead);
  playheadPosRef.current = playhead;

  // Update playhead cursor position via ref to avoid React re-renders on every frame
  useEffect(() => {
    if (!playheadRef.current || !laneAreaRef.current) return;
    const laneWidth = laneAreaRef.current.offsetWidth;
    const x = (playhead - viewport.scrollX) * viewport.pxPerFrame;
    playheadRef.current.style.transform = `translateX(${x}px)`;
    playheadRef.current.style.display = (x < 0 || x > laneWidth) ? 'none' : 'block';
  });

  // Window-level mouse handlers for drag.
  // Depends only on [session] — state is read via stateRef so this effect doesn't
  // re-subscribe on every session.execute() call (which would create a window where
  // no mouseup listener exists and make drags feel stuck).
  useEffect(() => {
    function scheduleUpdate() {
      // Throttle visual updates to one per animation frame (~60fps).
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          forceUpdate(n => n + 1);
        });
      }
    }

    function onMouseMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const vp = viewportRef.current;
      const s = stateRef.current;
      const deltaFrames = Math.round((e.clientX - drag.startX) / vp.pxPerFrame);

      if (drag.kind === 'move') {
        const newStart = Math.max(0, drag.originalStartFrame + deltaFrames);

        // Determine target track from Y position
        const lanesEl = lanesContainerRef.current;
        let currentTrackId = drag.currentTrackId;
        if (lanesEl) {
          const rect = lanesEl.getBoundingClientRect();
          const relY = e.clientY - rect.top + lanesEl.scrollTop;
          const trackIndex = Math.max(0, Math.min(tracksRef.current.length - 1, Math.floor(relY / vp.trackHeight)));
          const targetTrack = tracksRef.current[trackIndex];
          if (targetTrack) currentTrackId = targetTrack.stableId;
        }

        dragRef.current = { ...drag, currentStartFrame: newStart, currentTrackId };
        scheduleUpdate();
      } else if (drag.kind === 'trim-left') {
        const region = s.arrange.regions.get(drag.regionId);
        if (!region) return;
        const newTrimStart = Math.max(0, Math.min(drag.origTrimStart + deltaFrames, drag.origTrimEnd - 1));
        dragRef.current = { ...drag, currentTrimStart: newTrimStart };
        scheduleUpdate();
      } else if (drag.kind === 'trim-right') {
        const region = s.arrange.regions.get(drag.regionId);
        if (!region) return;
        const newTrimEnd = Math.min(region.numFrames, Math.max(drag.origTrimEnd + deltaFrames, drag.origTrimStart + 1));
        dragRef.current = { ...drag, currentTrimEnd: newTrimEnd };
        scheduleUpdate();
      }
    }

    async function onMouseUp() {
      // Cancel any pending animation frame so a stale render doesn't fire after drop
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Restore text selection
      document.body.style.userSelect = '';

      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;

      if (drag.kind === 'move') {
        const moved = drag.currentStartFrame !== drag.originalStartFrame;
        const retracked = drag.currentTrackId !== drag.originalTrackId;
        if (moved || retracked) {
          if (import.meta.env.DEV) performance.mark('drag:commit-start');
          await session.execute(
            session.makeMoveRegion(drag.regionId, drag.currentStartFrame, drag.currentTrackId),
          );
          if (import.meta.env.DEV) {
            performance.mark('drag:commit-end');
            performance.measure('drag:commit', 'drag:commit-start', 'drag:commit-end');
          }
        }
      } else if (drag.kind === 'trim-left' && drag.currentTrimStart !== drag.origTrimStart) {
        await session.execute(session.makeTrimRegion(drag.regionId, drag.currentTrimStart, drag.origTrimEnd));
      } else if (drag.kind === 'trim-right' && drag.currentTrimEnd !== drag.origTrimEnd) {
        await session.execute(session.makeTrimRegion(drag.regionId, drag.origTrimStart, drag.currentTrimEnd));
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [session]); // intentionally omits state — reads via stateRef

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = laneAreaRef.current?.getBoundingClientRect();
      const mouseX = rect ? e.clientX - rect.left : 0;
      setViewport(vp => {
        const frameUnderMouse = vp.scrollX + mouseX / vp.pxPerFrame;
        const factor = e.deltaY > 0 ? 0.8 : 1.25;
        const newPxPerFrame = Math.max(0.0002, Math.min(0.5, vp.pxPerFrame * factor));
        const newScrollX = Math.max(0, frameUnderMouse - mouseX / newPxPerFrame);
        return { ...vp, pxPerFrame: newPxPerFrame, scrollX: newScrollX };
      });
    } else {
      setViewport(vp => ({
        ...vp,
        scrollX: Math.max(0, vp.scrollX + e.deltaY / vp.pxPerFrame * 0.01),
      }));
    }
  }, []);

  const handleRulerClick = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frame = Math.round(viewport.scrollX + (e.clientX - rect.left) / viewport.pxPerFrame);
    onSeek(frame);
  }, [viewport, onSeek]);

  const handleRegionMouseDown = useCallback((regionId: string, e: React.MouseEvent) => {
    e.preventDefault(); // prevent text selection gesture from starting
    e.stopPropagation();
    document.body.style.userSelect = 'none'; // belt-and-suspenders: block selection globally during drag
    setSelectedRegionId(regionId);
    const region = stateRef.current.arrange.regions.get(regionId);
    if (!region) return;
    dragRef.current = {
      kind: 'move',
      regionId,
      startX: e.clientX,
      startY: e.clientY,
      originalStartFrame: region.startFrame,
      originalTrackId: region.trackId,
      currentStartFrame: region.startFrame,
      currentTrackId: region.trackId,
    };
  }, []); // no deps: reads state via stateRef

  const handleLeftTrimMouseDown = useCallback((regionId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.userSelect = 'none';
    const region = stateRef.current.arrange.regions.get(regionId);
    if (!region) return;
    dragRef.current = {
      kind: 'trim-left',
      regionId,
      startX: e.clientX,
      origTrimStart: region.trimStartFrame,
      origTrimEnd: region.trimEndFrame,
      currentTrimStart: region.trimStartFrame,
    };
  }, []); // no deps: reads state via stateRef

  const handleRightTrimMouseDown = useCallback((regionId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.userSelect = 'none';
    const region = stateRef.current.arrange.regions.get(regionId);
    if (!region) return;
    dragRef.current = {
      kind: 'trim-right',
      regionId,
      startX: e.clientX,
      origTrimStart: region.trimStartFrame,
      origTrimEnd: region.trimEndFrame,
      currentTrimEnd: region.trimEndFrame,
    };
  }, []); // no deps: reads state via stateRef

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    if (!audioContext) return;
    const rect = laneAreaRef.current?.getBoundingClientRect();
    const dropX = rect ? e.clientX - rect.left : 0;
    const dropFrame = Math.max(0, Math.round(viewport.scrollX + dropX / viewport.pxPerFrame));

    const store = session.getStore();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
    for (const file of files) {
      // 1. Decode audio (produces Float32Array views into Web Audio's internal heap)
      const buf  = await audioContext.decodeAudioData(await file.arrayBuffer());
      const pcmL = buf.getChannelData(0);
      const pcmR = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;

      // 2. Compute waveform peaks before writing (peaks need the full PCM in memory)
      const peaks = await computePeaksAsync(pcmL, pcmR, buf.length);

      // 3. Persist decoded PCM to OPFS + peaks/metadata to IndexedDB
      const fileId = crypto.randomUUID();
      await store.store(fileId, pcmL, pcmR, {
        fileId,
        name:       file.name,
        numFrames:  buf.length,
        sampleRate: buf.sampleRate,
        numChannels: buf.numberOfChannels,
      });
      // Associate peaks with fileId so undo of AddTrack can restore them from store
      peaks.regionId = fileId; // temporary; AddTrackCommand will set the real regionId
      await store.storePeaks(fileId, peaks);

      // 4. If the file's end is already behind the current playhead it would never play
      //    (track_process_frame returns silence when src_frame >= num_frames).
      //    Snap it forward so the file starts at the current playhead instead.
      const currentPlayhead = playheadPosRef.current;
      const startFrame = (dropFrame + buf.length <= currentPlayhead)
        ? currentPlayhead
        : dropFrame;

      // pcmL/pcmR go out of scope after this — GC-eligible; AudioBuffer can be released.
      // The actual chunk is loaded into WASM by AddTrackCommand via ChunkCacheManager.
      await session.execute(
        session.makeAddTrack(fileId, file.name, buf.length, buf.sampleRate, undefined, startFrame),
      );
    }
  }, [audioContext, session, viewport.scrollX, viewport.pxPerFrame]);

  function resolveRegion(region: RegionView): RegionView {
    const drag = dragRef.current;
    if (!drag || drag.regionId !== region.regionId) return region;
    if (drag.kind === 'move') return {
      ...region,
      startFrame: drag.currentStartFrame,
      trackId:    drag.currentTrackId,
    };
    if (drag.kind === 'trim-left') return { ...region, trimStartFrame: drag.currentTrimStart };
    if (drag.kind === 'trim-right') return { ...region, trimEndFrame: drag.currentTrimEnd };
    return region;
  }

  const tracks = [...state.tracks.values()];
  const laneWidth = (containerRef.current?.offsetWidth ?? 800) - TRACK_HEADER_WIDTH;

  return (
    <div
      className="arrange-view"
      ref={containerRef}
      onWheel={handleWheel}
    >
      {/* Ruler row: blank header spacer + time ruler */}
      <div className="arrange-ruler-row">
        <div className="arrange-ruler-spacer" style={{ width: TRACK_HEADER_WIDTH }} />
        <div className="arrange-ruler-canvas" onClick={handleRulerClick}>
          <Ruler
            scrollX={viewport.scrollX}
            pxPerFrame={viewport.pxPerFrame}
            width={Math.max(1, laneWidth)}
            sampleRate={44100}
          />
        </div>
      </div>

      {/* Track rows */}
      <div
        className="arrange-lanes"
        ref={lanesContainerRef}
        onClick={() => setSelectedRegionId(null)}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
      >
        {/* Playhead cursor — positioned inside the lane area only */}
        <div
          className="arrange-lane-overlay"
          style={{ left: TRACK_HEADER_WIDTH }}
        >
          <div
            ref={playheadRef}
            className="playhead-cursor"
          />
        </div>

        {tracks.length === 0 ? (
          <div className="arrange-empty">Drop audio files here to add tracks</div>
        ) : (
          tracks.map(track => {
            const drag = dragRef.current;
            // During a cross-track move, render the dragged region in its CURRENT target track's lane
            const trackRegions = [...state.arrange.regions.values()]
              .filter(r => {
                if (drag?.kind === 'move' && drag.regionId === r.regionId) {
                  return drag.currentTrackId === track.stableId;
                }
                return r.trackId === track.stableId;
              })
              .map(resolveRegion);

            // Build per-region peaks map for this track's visible regions
            const peaksMap = new Map<string, WaveformPeaks>();
            for (const region of trackRegions) {
              const p = session.getWaveformPeaks(region.regionId);
              if (p) peaksMap.set(region.regionId, p);
            }

            return (
              <div key={track.stableId} className="arrange-track-row">
                <TrackHeader
                  session={session}
                  track={track}
                  height={viewport.trackHeight}
                />
                <div ref={laneAreaRef} className="arrange-lane-cell">
                  <TrackLane
                    track={track}
                    regions={trackRegions}
                    peaksMap={peaksMap}
                    viewport={viewport}
                    laneWidth={laneWidth}
                    selectedRegionId={selectedRegionId}
                    onRegionMouseDown={handleRegionMouseDown}
                    onLeftTrimMouseDown={handleLeftTrimMouseDown}
                    onRightTrimMouseDown={handleRightTrimMouseDown}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
