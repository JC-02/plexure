import type { Distance, PlexureInput, PlexureOptions } from './types';

/**
 * Defaults reproduce the original portfolio field as it actually looked on its 165 Hz
 * development display. The engine is time-normalised (60 fps units), so the historical
 * per-frame constants are scaled by the 2.73× the original hardware effectively applied:
 * velocities (drift) scale ×2.75, accelerations (cursor.strength) ×2.75², and decay rates
 * (friction, intensity easing) compound as exponents.
 */
export const defaults: PlexureOptions = {
  density: 11000,
  count: undefined,
  minCount: 24,
  maxCount: 160,
  drift: [0.49, 1.31],
  friction: 0.96,
  star: { size: [0.8, 2.3], opacity: 0.6, softness: 0, color: '#EBE9E4' },
  link: { distance: 130, width: 0.7, opacity: 0.32, color: '#EBE9E4' },
  cursor: {
    enabled: true,
    radius: 200,
    strength: 0.41,
    maxLinks: 10,
    width: 1,
    opacity: 0.62,
    color: '#EBE9E4',
  },
  edgeBehaviour: 'wrap',
  edgeDistance: 40,
  clipTo: null,
  intensity: 1,
  clampDistances: true,
  respectReducedMotion: true,
  reducedMotion: 'static',
  pauseWhenHidden: true,
  pauseWhenOffscreen: true,
  maxDpr: 2,
  seed: undefined,
  zIndex: 0,
  className: undefined,
};

/**
 * Spread-with-undefined would clobber base values, so patch keys are copied only when set.
 * Prototype-shaped keys are skipped so merging attacker-influenced JSON can never become a
 * pollution vector, today or after a future refactor.
 */
function assign<T extends object>(base: T, patch: Partial<T> | undefined): T {
  const out = { ...base };
  if (patch) {
    for (const k in patch) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const v = patch[k];
      if (v !== undefined) out[k] = v as T[Extract<keyof T, string>];
    }
  }
  return out;
}

export function mergeOptions(
  base: PlexureOptions,
  input: PlexureInput | undefined,
): PlexureOptions {
  const out = assign(base, input as Partial<PlexureOptions> | undefined);
  out.star = assign(base.star, input?.star);
  out.link = assign(base.link, input?.link);
  out.cursor = assign(base.cursor, input?.cursor);
  return out;
}

/**
 * Resolve a distance option against the container. `'35%'` means 35% of the smaller edge.
 * Absolute px values are clamped to `clampFrac` of `clampEdge` unless clamping is off, so
 * defaults tuned for a viewport stay legible inside a 300 px card. The caller picks the
 * clamp basis: the geometric mean of the edges for link/cursor distances (so slivers keep
 * useful link lengths along their long axis), the smaller edge for edge margins.
 */
export function resolveDistance(
  value: Distance,
  minEdge: number,
  clampEdge: number,
  clampFrac: number,
  clamp: boolean,
): number {
  if (typeof value === 'string') return (Number.parseFloat(value) / 100) * minEdge;
  return clamp ? Math.min(value, clampEdge * clampFrac) : value;
}
