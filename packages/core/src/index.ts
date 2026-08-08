import { createField } from './field';
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

/** Inert handle returned when there is no DOM, so SSR code paths never throw. */
const noop: PlexureInstance = {
  setOptions() {},
  pause() {},
  resume() {},
  refresh() {},
  destroy() {},
  isRunning: false,
};

/**
 * Mount a plexure field.
 *
 * @param target An element to scope the field to, `'viewport'` for a fixed full-viewport
 * field, or `'page'` for one spanning the full scrollable document.
 */
export function createPlexure(target: PlexureTarget, options?: PlexureInput): PlexureInstance {
  if (typeof window === 'undefined' || typeof document === 'undefined') return noop;
  return createField(target, options);
}
