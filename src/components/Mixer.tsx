import type { Session } from '../Session.js';
import type { SessionState } from '../types.js';
import { TrackStrip } from './TrackStrip.js';

interface Props {
  session: Session;
  state: SessionState;
}

export function Mixer({ session, state }: Props) {
  return (
    <div className="mixer">
      {[...state.tracks.values()].map(track => (
        <TrackStrip key={track.stableId} session={session} track={track} />
      ))}
    </div>
  );
}
