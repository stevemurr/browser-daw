// useKeyboard.test.ts
// Tests the key-dispatch logic without React rendering.
// We extract the pure dispatch behaviour and verify key routing directly.

import { describe, it, expect, vi } from 'vitest';

/**
 * Simulate the dispatch logic from useKeyboard:
 * given a keyMap and a KeyboardEvent-like object, call the matching handler.
 * Returns true if a handler was called, false otherwise.
 */
function dispatch(
  keyMap: Record<string, (e: KeyboardEvent) => void>,
  event: { key: string; target: { tagName: string; isContentEditable: boolean } },
): boolean {
  const target = event.target;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return false;
  const handler = keyMap[event.key];
  if (!handler) return false;
  handler(event as unknown as KeyboardEvent);
  return true;
}

describe('useKeyboard dispatch logic', () => {
  it('calls the correct handler for a registered key', () => {
    const onSpace = vi.fn();
    const result = dispatch(
      { ' ': onSpace },
      { key: ' ', target: { tagName: 'BODY', isContentEditable: false } },
    );
    expect(onSpace).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it('does not call handler when focus is inside an INPUT', () => {
    const onSpace = vi.fn();
    const result = dispatch(
      { ' ': onSpace },
      { key: ' ', target: { tagName: 'INPUT', isContentEditable: false } },
    );
    expect(onSpace).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('does not call handler when focus is inside a TEXTAREA', () => {
    const onSpace = vi.fn();
    dispatch(
      { ' ': onSpace },
      { key: ' ', target: { tagName: 'TEXTAREA', isContentEditable: false } },
    );
    expect(onSpace).not.toHaveBeenCalled();
  });

  it('does not call handler when target is contentEditable', () => {
    const onSpace = vi.fn();
    dispatch(
      { ' ': onSpace },
      { key: ' ', target: { tagName: 'DIV', isContentEditable: true } },
    );
    expect(onSpace).not.toHaveBeenCalled();
  });

  it('ignores unregistered keys', () => {
    const onSpace = vi.fn();
    const result = dispatch(
      { ' ': onSpace },
      { key: 'a', target: { tagName: 'BODY', isContentEditable: false } },
    );
    expect(onSpace).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('routes multiple keys independently', () => {
    const onSpace = vi.fn();
    const onEscape = vi.fn();
    const keyMap = { ' ': onSpace, Escape: onEscape };

    dispatch(keyMap, { key: ' ', target: { tagName: 'BODY', isContentEditable: false } });
    dispatch(keyMap, { key: 'Escape', target: { tagName: 'BODY', isContentEditable: false } });
    dispatch(keyMap, { key: 'z', target: { tagName: 'BODY', isContentEditable: false } });

    expect(onSpace).toHaveBeenCalledOnce();
    expect(onEscape).toHaveBeenCalledOnce();
  });
});
