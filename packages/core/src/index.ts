import { createField, inert } from './field';
import type { PlexureInput, PlexureInstance, PlexureTarget } from './types';

export { defaults } from './options';
export type {
  CursorOptions,
  Distance,
  EdgeBehaviour,
  LinkOptions,
  PlexureInput,
  PlexureInstance,
  PlexureOptions,
  PlexureTarget,
  StarOptions,
} from './types';

/**
 * Mount a plexure field.
 *
 * Returns an inert handle — safe to call, renders nothing — in any environment that cannot
 * actually paint: a server with no DOM, or a simulated DOM such as jsdom, which is what
 * consumers' own unit tests run in. Mounting a field must never be the reason someone
 * else's test suite fails, so this degrades instead of throwing.
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
