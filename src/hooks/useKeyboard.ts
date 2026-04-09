import { useEffect, useRef } from 'react';

/** Map of key names (e.g. ' ', 'Escape', 'ArrowLeft') to handler functions. */
export type KeyMap = Record<string, (e: KeyboardEvent) => void>;

/**
 * Registers window-level keydown listeners for the supplied keyMap.
 * Handlers are NOT called when focus is inside an input or textarea.
 *
 * The keyMap reference is not required to be stable — a new ref-wrapped copy
 * is used on every render so stale closures are never a problem.
 */
export function useKeyboard(keyMap: KeyMap): void {
  // Keep a stable ref so we don't re-subscribe on every render
  const mapRef = useRef<KeyMap>(keyMap);
  mapRef.current = keyMap;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      const handler = mapRef.current[e.key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // subscribe once — mapRef always has the latest map
}
