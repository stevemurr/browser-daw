import type { TrackMirror, RegionView, WaveformPeaks } from '../types.js';
import { RegionBlock } from './RegionBlock.js';

interface Viewport {
  scrollX: number;
  pxPerFrame: number;
  trackHeight: number;
}

interface TrackLaneProps {
  track: TrackMirror;
  regions: RegionView[];
  peaksMap: Map<string, WaveformPeaks>; // regionId → peaks
  viewport: Viewport;
  laneWidth: number;
  selectedRegionId: string | null;
  onRegionMouseDown: (regionId: string, e: React.MouseEvent) => void;
  onLeftTrimMouseDown: (regionId: string, e: React.MouseEvent) => void;
  onRightTrimMouseDown: (regionId: string, e: React.MouseEvent) => void;
}

export function TrackLane({
  track,
  regions,
  peaksMap,
  viewport,
  laneWidth,
  selectedRegionId,
  onRegionMouseDown,
  onLeftTrimMouseDown,
  onRightTrimMouseDown,
}: TrackLaneProps) {
  return (
    <div
      className="track-lane"
      data-track-id={track.stableId}
      style={{ height: viewport.trackHeight, position: 'relative', overflow: 'hidden' }}
    >
      {regions.map(region => (
        <RegionBlock
          key={region.regionId}
          region={region}
          peaks={peaksMap.get(region.regionId)}
          viewport={viewport}
          laneWidth={laneWidth}
          isSelected={region.regionId === selectedRegionId}
          onMouseDown={(e) => onRegionMouseDown(region.regionId, e)}
          onLeftTrimMouseDown={(e) => onLeftTrimMouseDown(region.regionId, e)}
          onRightTrimMouseDown={(e) => onRightTrimMouseDown(region.regionId, e)}
        />
      ))}
    </div>
  );
}
