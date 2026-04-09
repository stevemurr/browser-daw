// useSessionAutoSave — debounced 500ms auto-save on every session state change.
import { useEffect, useRef } from 'react';
import type { Session } from '../Session.js';
import { saveSession } from '../store/SessionStore.js';

export function useSessionAutoSave(
  session: Session | null,
  sessionId: string | null,
  sessionName: string,
  sessionCreatedAt: number | null,
): void {
  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so the timer callback always sees the latest values without re-subscribing.
  const idRef         = useRef(sessionId);
  const nameRef       = useRef(sessionName);
  const createdAtRef  = useRef(sessionCreatedAt);

  idRef.current        = sessionId;
  nameRef.current      = sessionName;
  createdAtRef.current = sessionCreatedAt;

  useEffect(() => {
    if (!session || !sessionId) return;

    const unsubscribe = session.subscribe(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const id        = idRef.current;
        const name      = nameRef.current;
        const createdAt = createdAtRef.current;
        if (!id) return;
        const serialized = session.serialize(id, name, createdAt ?? undefined);
        saveSession(serialized).catch(err =>
          console.error('[useSessionAutoSave] save error:', err),
        );
      }, 500);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // Re-subscribe only when the session instance or sessionId changes (i.e. on session switch).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionId]);
}
