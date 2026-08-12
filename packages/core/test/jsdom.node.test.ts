// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createPlexure } from '../src/index';

/**
 * jsdom is where other people's tests run — vitest, jest and React Testing Library all
 * default to it. It has a DOM but no matchMedia, no ResizeObserver and no canvas, so a
 * field cannot render there. Mounting one must still be completely uneventful: nobody
 * should have to mock this library to unit-test the component that uses it.
 */
describe('jsdom, as a consumer would run it', () => {
  it('has a DOM but not the APIs a field needs', () => {
    expect(typeof document).toBe('object');
    expect(typeof window.matchMedia).toBe('undefined');
    expect(typeof globalThis.ResizeObserver).toBe('undefined');
  });

  it('mounts into an element without throwing', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    expect(() => createPlexure(host)).not.toThrow();
  });

  it.each(['viewport', 'page'] as const)('mounts a %s field without throwing', (target) => {
    expect(() => createPlexure(target)).not.toThrow();
  });

  it('leaves the host DOM exactly as it found it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    createPlexure(host);
    expect(host.querySelector('canvas')).toBeNull();
    expect(host.style.position).toBe('');
    expect(host.attributes).toHaveLength(0);
  });

  it('returns a handle that is safe to drive', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const field = createPlexure(host, { count: 40 });
    expect(field.isRunning).toBe(false);
    expect(() => {
      field.setOptions({ density: 1000, intensity: 0.5 });
      field.pause();
      field.resume();
      field.refresh();
      field.destroy();
      field.destroy();
    }).not.toThrow();
  });

  it('never starts an animation loop', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    createPlexure(host);
    expect(createPlexure(host).isRunning).toBe(false);
  });
});
