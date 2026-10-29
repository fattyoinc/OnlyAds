import { useCallback, useEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';

import { layout } from '@/theme';

/** Content width, capped so tablets/web don't stretch phone layouts. */
export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  return Math.min(width, layout.maxContentWidth);
}

/** Width of one masonry column for the current screen. */
export function useColumnWidth(): number {
  const w = useContentWidth();
  return Math.floor((w - layout.inset * 2 - layout.gutter) / 2);
}

/**
 * Ignores repeat taps within `ms` (or while the returned promise is pending).
 * Prevents double click-outs, double dismissals, double permission prompts.
 */
export function useGuardedAction<A extends unknown[]>(fn: (...args: A) => unknown, ms = 800) {
  const busy = useRef(false);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  return useCallback(
    async (...args: A) => {
      if (busy.current) return;
      busy.current = true;
      const started = Date.now();
      try {
        await fnRef.current(...args);
      } finally {
        setTimeout(() => (busy.current = false), Math.max(0, ms - (Date.now() - started)));
      }
    },
    [ms],
  );
}
