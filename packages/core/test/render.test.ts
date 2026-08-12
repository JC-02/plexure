import { afterEach, describe, expect, it } from 'vitest';
import { createPlexure } from '../src/index';
import type { PlexureInput, PlexureInstance } from '../src/types';
import { canvasIn, cleanup, mountHost, RESIZE_SETTLE_MS, sample, track, wait } from './helpers';

afterEach(cleanup);

/**
 * A field frozen on its seeded initial state: `pause()` runs synchronously before the
 * shared ticker can deliver a frame, so nothing has stepped yet and the render is a pure
 * function of the seed. Metrics are derived rather than hashed, so antialiasing differences
 * between platforms do not turn into failures.
 */
function still(host: HTMLElement, options: PlexureInput = {}): PlexureInstance {
  const field = track(createPlexure(host, { maxDpr: 1, seed: 1234, ...options }));
  field.pause();
  return field;
}

/** Dots only — links removed so painted pixels reflect particle positions alone. */
const DOTS_ONLY: PlexureInput = { link: { opacity: 0 }, cursor: { enabled: false } };

describe('determinism', () => {
  it('renders identically for the same seed', () => {
    const a = mountHost(400, 300);
    const b = mountHost(400, 300);
    still(a, { count: 60, seed: 99 });
    still(b, { count: 60, seed: 99 });

    const sa = sample(canvasIn(a));
    const sb = sample(canvasIn(b));
    expect(sa.painted).toBe(sb.painted);
    expect(sa.centroid.x).toBeCloseTo(sb.centroid.x, 6);
    expect(sa.centroid.y).toBeCloseTo(sb.centroid.y, 6);
    expect(sa.bounds).toEqual(sb.bounds);
  });

  it('renders differently for a different seed', () => {
    const a = mountHost(400, 300);
    const b = mountHost(400, 300);
    still(a, { count: 60, seed: 1 });
    still(b, { count: 60, seed: 2 });
    expect(sample(a.querySelector('canvas') as HTMLCanvasElement).centroid.x).not.toBeCloseTo(
      sample(b.querySelector('canvas') as HTMLCanvasElement).centroid.x,
      3,
    );
  });

  // Documented behaviour, not an accident: changing the seed swaps the generator for
  // future spawns and leaves particles that already exist where they are. Reseeding the
  // whole field would read as a jump. (Open v0.2 question — see roadmap item 6.)
  it('leaves existing particles in place when the seed changes', () => {
    const a = mountHost(400, 300);
    const field = still(a, { count: 60, seed: 7, ...DOTS_ONLY });
    const before = sample(canvasIn(a)).centroid.x;
    field.setOptions({ seed: 8 });
    field.pause();
    field.refresh();
    expect(sample(canvasIn(a)).centroid.x).toBeCloseTo(before, 6);
  });

  it('applies a new seed to particles spawned after the change', () => {
    const a = mountHost(400, 300);
    const b = mountHost(400, 300);
    const fa = still(a, { count: 40, seed: 7, ...DOTS_ONLY });
    const fb = still(b, { count: 40, seed: 7, ...DOTS_ONLY });
    expect(sample(canvasIn(a)).painted).toBe(sample(canvasIn(b)).painted);

    // Same 40 particles carried over, 100 new ones drawn from different generators.
    for (const [field, seed] of [
      [fa, 111],
      [fb, 222],
    ] as const) {
      field.setOptions({ seed, count: 140 });
      field.pause();
      field.refresh();
    }
    expect(sample(canvasIn(a)).centroid.x).not.toBeCloseTo(sample(canvasIn(b)).centroid.x, 3);
  });
});

describe('the field occupies its container', () => {
  it('paints across the full box', () => {
    const host = mountHost(400, 300);
    still(host, { count: 120, ...DOTS_ONLY });
    const s = sample(canvasIn(host));
    expect(s.painted).toBeGreaterThan(0);
    expect(s.bounds.minX).toBeLessThan(s.width * 0.25);
    expect(s.bounds.maxX).toBeGreaterThan(s.width * 0.75);
    expect(s.bounds.minY).toBeLessThan(s.height * 0.25);
    expect(s.bounds.maxY).toBeGreaterThan(s.height * 0.75);
  });

  it('centres roughly on the middle of the box', () => {
    const host = mountHost(400, 300);
    still(host, { count: 160, ...DOTS_ONLY });
    const s = sample(canvasIn(host));
    // A uniform field's centroid sits near the centre; generous slack for 160 samples.
    expect(s.centroid.x).toBeGreaterThan(s.width * 0.3);
    expect(s.centroid.x).toBeLessThan(s.width * 0.7);
    expect(s.centroid.y).toBeGreaterThan(s.height * 0.3);
    expect(s.centroid.y).toBeLessThan(s.height * 0.7);
  });

  it('paints more with more particles', () => {
    const sparse = mountHost(400, 300);
    const dense = mountHost(400, 300);
    still(sparse, { count: 20, ...DOTS_ONLY });
    still(dense, { count: 140, ...DOTS_ONLY });
    expect(sample(canvasIn(dense)).painted).toBeGreaterThan(sample(canvasIn(sparse)).painted * 2);
  });

  it('paints more with larger stars', () => {
    const small = mountHost(400, 300);
    const big = mountHost(400, 300);
    still(small, { count: 60, ...DOTS_ONLY, star: { size: [1, 1] } });
    still(big, { count: 60, ...DOTS_ONLY, star: { size: [4, 4] } });
    expect(sample(canvasIn(big)).painted).toBeGreaterThan(sample(canvasIn(small)).painted);
  });
});

describe('intensity', () => {
  it('paints nothing at zero', () => {
    const host = mountHost(400, 300);
    still(host, { count: 80, intensity: 0 });
    expect(sample(canvasIn(host)).painted).toBe(0);
  });

  it('paints less as intensity falls', () => {
    const full = mountHost(400, 300);
    const dim = mountHost(400, 300);
    still(full, { count: 80, intensity: 1 });
    still(dim, { count: 80, intensity: 0.15 });
    expect(sample(canvasIn(dim)).painted).toBeLessThan(sample(canvasIn(full)).painted);
  });
});

describe('links', () => {
  it('paints more with links than without', () => {
    const linked = mountHost(400, 300);
    const bare = mountHost(400, 300);
    still(linked, { count: 100, cursor: { enabled: false } });
    still(bare, { count: 100, ...DOTS_ONLY });
    expect(sample(canvasIn(linked)).painted).toBeGreaterThan(sample(canvasIn(bare)).painted);
  });

  it('paints fewer links as the link distance shrinks', () => {
    const near = mountHost(400, 300);
    const far = mountHost(400, 300);
    still(near, { count: 100, cursor: { enabled: false }, link: { distance: 20 } });
    still(far, { count: 100, cursor: { enabled: false }, link: { distance: 130 } });
    expect(sample(canvasIn(far)).painted).toBeGreaterThan(sample(canvasIn(near)).painted);
  });
});

describe('Path2D clipping', () => {
  // Today clipTo only clips the *render*; the simulation still runs in the full bounding
  // box. Making the sim itself shape-aware is the v0.2 headline feature, and these bounds
  // assertions are what will confirm it once it lands.
  it('confines painting to the path', () => {
    const host = mountHost(400, 300);
    const path = new Path2D();
    path.rect(0, 0, 120, 90);
    still(host, { count: 120, clipTo: path, ...DOTS_ONLY });

    const s = sample(canvasIn(host));
    expect(s.painted).toBeGreaterThan(0);
    expect(s.bounds.maxX).toBeLessThanOrEqual(121);
    expect(s.bounds.maxY).toBeLessThanOrEqual(91);
  });

  it('paints well beyond that region without the clip', () => {
    const host = mountHost(400, 300);
    still(host, { count: 120, ...DOTS_ONLY });
    const s = sample(canvasIn(host));
    expect(s.bounds.maxX).toBeGreaterThan(200);
    expect(s.bounds.maxY).toBeGreaterThan(150);
  });

  it('clips to a non-rectangular path', () => {
    const host = mountHost(400, 300);
    const path = new Path2D();
    path.arc(200, 150, 60, 0, Math.PI * 2);
    still(host, { count: 160, clipTo: path, ...DOTS_ONLY });

    const s = sample(canvasIn(host));
    expect(s.painted).toBeGreaterThan(0);
    expect(s.bounds.minX).toBeGreaterThanOrEqual(139);
    expect(s.bounds.maxX).toBeLessThanOrEqual(261);
    expect(s.bounds.minY).toBeGreaterThanOrEqual(89);
    expect(s.bounds.maxY).toBeLessThanOrEqual(211);
  });
});

describe('resize', () => {
  it('maps particles proportionally rather than reseeding them', async () => {
    const host = mountHost(400, 300);
    still(host, { count: 40, ...DOTS_ONLY });
    const before = sample(canvasIn(host)).centroid.x;

    host.style.width = '800px';
    await wait(RESIZE_SETTLE_MS);

    const after = sample(canvasIn(host)).centroid.x;
    // Doubling the width doubles every x; a reseed would land somewhere unrelated.
    expect(after).toBeCloseTo(before * 2, -1);
  });
});
