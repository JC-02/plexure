import { describe, expect, it } from 'vitest';

/**
 * Invariant: no browser globals at module scope. This file runs in a real node
 * environment with no `window` and no `document`, which is the only place that claim can
 * be tested — importing the package on a server must never throw, and the handle it hands
 * back must be safe to call.
 */
describe('SSR safety', () => {
  it('runs in an environment with no DOM', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('imports the public entry without touching a browser global', async () => {
    await expect(import('../src/index')).resolves.toBeDefined();
  });

  // Every module, not just the entry: a stray module-scope `document.createElement` in any
  // of them would only surface once a bundler pulled it in.
  it.each([
    ['color', () => import('../src/color')],
    ['field', () => import('../src/field')],
    ['index', () => import('../src/index')],
    ['options', () => import('../src/options')],
    ['pointer', () => import('../src/pointer')],
    ['rng', () => import('../src/rng')],
    ['ticker', () => import('../src/ticker')],
  ] as const)('imports ./%s without throwing', async (_name, load) => {
    await expect(load()).resolves.toBeDefined();
  });

  it('returns an inert handle instead of throwing', async () => {
    const { createPlexure } = await import('../src/index');
    const field = createPlexure('viewport');
    expect(field).toBeDefined();
    expect(field.isRunning).toBe(false);
  });

  it('exposes the full instance surface on the inert handle', async () => {
    const { createPlexure } = await import('../src/index');
    const field = createPlexure('viewport', { density: 5000 });
    for (const method of ['setOptions', 'pause', 'resume', 'refresh', 'destroy'] as const) {
      expect(typeof field[method]).toBe('function');
    }
  });

  it('accepts every call on the inert handle silently', async () => {
    const { createPlexure } = await import('../src/index');
    const field = createPlexure('page', { intensity: 0.5 });
    expect(() => {
      field.setOptions({ density: 1000 });
      field.pause();
      field.resume();
      field.refresh();
      field.destroy();
      field.destroy();
    }).not.toThrow();
    expect(field.isRunning).toBe(false);
  });

  it('exports defaults for server-side option composition', async () => {
    const { defaults } = await import('../src/index');
    expect(defaults.density).toBeGreaterThan(0);
  });
});
