import { createField, inert } from './field';
import type { PlexureInput, PlexureInstance, PlexureTarget } from './types';

export { defaults } from './options';
export type {
  ClipFit,
  CursorOptions,
  Distance,
  EdgeBehaviour,
  LinkOptions,
  PlexureInput,
  PlexureInstance,
  PlexureOptions,
  PlexureTarget,
  ShapeClip,
  StarOptions,
  WindowClip,
} from './types';

/**
 * Mount a plexure field.
 *
 * Anywhere it cannot paint, this returns an inert handle. Every method is safe to call and
 * nothing renders. That covers a server with no DOM, and a simulated DOM like jsdom, where
 * most consumers run their own tests. Mounting a field should never be the reason someone
 * else's test suite fails.
 *
 * @param target An element to scope the field to, `'viewport'` for a fixed full-viewport
 * field, or `'page'` for one spanning the full scrollable document.
 */
export function createPlexure(target: PlexureTarget, options?: PlexureInput): PlexureInstance {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof window.matchMedia !== 'function' ||
    typeof ResizeObserver === 'undefined'
  ) {
    return inert;
  }
  return createField(target, options);
}
