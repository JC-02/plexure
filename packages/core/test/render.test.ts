import { afterEach, describe, expect, it } from 'vitest';
import { createPlexure } from '../src/index';
import type { PlexureInput, PlexureInstance } from '../src/types';
import {
  canvasIn,
  cleanup,
  mountHost,
  nextFrames,
  RESIZE_SETTLE_MS,
  sample,
  track,
  wait,
} from './helpers';

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

  // Seeding determinism is not simulation determinism: the tests above freeze the field
  // before it steps. This one lets it run, so a stray Math.random() anywhere in step() or
  // respawn() shows up. Both fields ride the same shared ticker, so they receive an
  // identical dt every frame and must stay in lockstep.
  it('stays identical after many stepped frames with the same seed', async () => {
    const a = mountHost(400, 300);
    const b = mountHost(400, 300);
    const drifting = mountHost(400, 300);
    track(createPlexure(a, { count: 60, seed: 42, maxDpr: 1, ...DOTS_ONLY }));
    track(createPlexure(b, { count: 60, seed: 42, maxDpr: 1, ...DOTS_ONLY }));
    track(createPlexure(drifting, { count: 60, seed: 43, maxDpr: 1, ...DOTS_ONLY }));

    await nextFrames(20);

    const sa = sample(canvasIn(a));
    const sb = sample(canvasIn(b));
    expect(sa.painted).toBeGreaterThan(0);
    expect(sa.painted).toBe(sb.painted);
    expect(sa.centroid.x).toBeCloseTo(sb.centroid.x, 6);
    expect(sa.centroid.y).toBeCloseTo(sb.centroid.y, 6);
    // Guards the comparison from being trivially true: a different seed must diverge.
    expect(sample(canvasIn(drifting)).centroid.x).not.toBeCloseTo(sa.centroid.x, 3);
  });

  it('keeps a seeded field reproducible across a respawn cycle', async () => {
    const a = mountHost(200, 150);
    const b = mountHost(200, 150);
    // 'respawn' recycles particles through spawn(), so the RNG is consumed while running.
    const opts = {
      count: 40,
      seed: 8,
      maxDpr: 1,
      edgeBehaviour: 'respawn' as const,
      ...DOTS_ONLY,
    };
    track(createPlexure(a, opts));
    track(createPlexure(b, opts));

    await nextFrames(30);

    expect(sample(canvasIn(a)).painted).toBe(sample(canvasIn(b)).painted);
    expect(sample(canvasIn(a)).centroid.x).toBeCloseTo(sample(canvasIn(b)).centroid.x, 6);
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

describe('spatial hash', () => {
  /**
   * Read one frame twice over: every particle draws exactly one `arc`, which gives their
   * real positions, and every particle-to-particle link is one `stroke`. With the cursor
   * off, nothing else strokes.
   */
  function readFrame(field: PlexureInstance): { points: Array<[number, number]>; strokes: number } {
    // Pause first, outside the patch: pause() renders its own still frame, which would
    // otherwise be captured too and double every count.
    field.pause();

    const proto = CanvasRenderingContext2D.prototype;
    const origArc = proto.arc;
    const origStroke = proto.stroke;
    const points: Array<[number, number]> = [];
    let strokes = 0;
    proto.arc = function (this: CanvasRenderingContext2D, x: number, y: number, ...rest) {
      points.push([x, y]);
      return origArc.call(this, x, y, ...(rest as [number, number, number, boolean?]));
    };
    proto.stroke = function (this: CanvasRenderingContext2D, ...args: []) {
      strokes++;
      return origStroke.apply(this, args);
    };
    try {
      field.refresh();
    } finally {
      proto.arc = origArc;
      proto.stroke = origStroke;
    }
    return { points, strokes };
  }

  function bruteForcePairs(points: Array<[number, number]>, within: number): number {
    let pairs = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i][0] - points[j][0];
        const dy = points[i][1] - points[j][1];
        if (dx * dx + dy * dy < within * within) pairs++;
      }
    }
    return pairs;
  }

  // The grid replaced a stacked O(n²) scan, and the neighbour walk only visits four of the
  // eight neighbours so each pair is covered once. Checking it against brute force over the
  // real positions catches both failure modes at once: a missed pair and a doubled one.
  it('links every in-range pair exactly once, across many cells', () => {
    const host = mountHost(400, 300);
    // distance 60 over a 400×300 box gives a 7×5 grid, so cross-cell coverage matters.
    const field = track(
      createPlexure(host, {
        count: 90,
        seed: 5,
        maxDpr: 1,
        clampDistances: false,
        cursor: { enabled: false },
        link: { distance: 60 },
      }),
    );

    const { points, strokes } = readFrame(field);
    expect(points).toHaveLength(90);
    const expected = bruteForcePairs(points, 60);
    expect(expected).toBeGreaterThan(20);
    expect(strokes).toBe(expected);
  });

  it('agrees with brute force when the whole field fits in one cell', () => {
    const host = mountHost(400, 300);
    const field = track(
      createPlexure(host, {
        count: 24,
        seed: 11,
        maxDpr: 1,
        clampDistances: false,
        cursor: { enabled: false },
        link: { distance: 5000 },
      }),
    );

    const { points, strokes } = readFrame(field);
    // Every pair is in range, so this pins the exact combination count.
    expect(strokes).toBe((points.length * (points.length - 1)) / 2);
  });

  it('draws no links at all when the range is tiny', () => {
    const host = mountHost(400, 300);
    const field = track(
      createPlexure(host, {
        count: 30,
        seed: 3,
        maxDpr: 1,
        clampDistances: false,
        cursor: { enabled: false },
        link: { distance: 1 },
      }),
    );
    expect(readFrame(field).strokes).toBe(0);
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
