import { afterEach, describe, expect, it } from 'vitest';
import { createPlexure } from '../src/index';
import type { PlexureInput, PlexureInstance, ShapeClip } from '../src/types';
import { canvasIn, cleanup, mountHost, nextFrames, sample, track } from './helpers';

afterEach(cleanup);

/** Links off, cursor off: painted pixels and recorded arcs are particle positions alone. */
const DOTS_ONLY: PlexureInput = { link: { opacity: 0 }, cursor: { enabled: false } };

/** A centred square covering the middle third of a 0..300 coordinate space. */
const SQUARE = 'M 100 100 H 200 V 200 H 100 Z';

function still(host: HTMLElement, options: PlexureInput = {}): PlexureInstance {
  const field = track(createPlexure(host, { maxDpr: 1, seed: 1234, ...options }));
  field.pause();
  return field;
}

/** Particle positions, read from the one arc each particle draws per frame. */
function positions(field: PlexureInstance): Array<[number, number]> {
  field.pause();
  const proto = CanvasRenderingContext2D.prototype;
  const original = proto.arc;
  const points: Array<[number, number]> = [];
  proto.arc = function (this: CanvasRenderingContext2D, x: number, y: number, ...rest) {
    points.push([x, y]);
    return original.call(this, x, y, ...(rest as [number, number, number, boolean?]));
  };
  try {
    field.refresh();
  } finally {
    proto.arc = original;
  }
  return points;
}

/** Independent containment check, deliberately not using the engine's own helper. */
function makeTester(path: string | Path2D, matrix?: DOMMatrix) {
  const canvas = document.createElement('canvas');
  canvas.width = 2000;
  canvas.height = 2000;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let p = typeof path === 'string' ? new Path2D(path) : path;
  if (matrix) {
    const fitted = new Path2D();
    fitted.addPath(p, matrix);
    p = fitted;
  }
  return (x: number, y: number) => ctx.isPointInPath(p, x, y);
}

describe('sim-aware shape: seeding', () => {
  it('seeds every particle inside the shape', () => {
    const host = mountHost(300, 300);
    // fit 'none' keeps path coordinates equal to container pixels, so the expected region
    // is known exactly without depending on the fit maths.
    const field = still(host, {
      count: 120,
      clipTo: { path: SQUARE, fit: 'none' },
      ...DOTS_ONLY,
    });

    const points = positions(field);
    expect(points.length).toBeGreaterThan(0);
    const inside = makeTester(SQUARE);
    for (const [x, y] of points) expect(inside(x, y)).toBe(true);
  });

  it('honours the requested count inside the shape', () => {
    const host = mountHost(300, 300);
    const field = still(host, {
      count: 80,
      clipTo: { path: SQUARE, fit: 'none' },
      ...DOTS_ONLY,
    });
    expect(positions(field)).toHaveLength(80);
  });

  it('fills a shape that covers a small slice of its container', () => {
    const host = mountHost(400, 300);
    // A 400x16 sliver: sampling the container box would reject almost every candidate.
    const sliver = 'M 0 142 H 400 V 158 H 0 Z';
    const field = still(host, {
      count: 100,
      clipTo: { path: sliver, fit: 'none' },
      ...DOTS_ONLY,
    });
    const points = positions(field);
    expect(points).toHaveLength(100);
    const inside = makeTester(sliver);
    for (const [x, y] of points) expect(inside(x, y)).toBe(true);
  });

  it('keeps the hollow of a concave shape empty', () => {
    const host = mountHost(300, 300);
    // A ring: outer circle with an inner circle subtracted by the even-odd/nonzero rule.
    const ring =
      'M 150 30 A 120 120 0 1 0 150 270 A 120 120 0 1 0 150 30 Z M 150 90 A 60 60 0 1 1 150 210 A 60 60 0 1 1 150 90 Z';
    const field = still(host, {
      count: 120,
      clipTo: { path: ring, fit: 'none' },
      ...DOTS_ONLY,
    });
    const points = positions(field);
    expect(points.length).toBeGreaterThan(0);
    const inside = makeTester(ring);
    for (const [x, y] of points) expect(inside(x, y)).toBe(true);
  });
});

describe('sim-aware shape: containment over time', () => {
  it('keeps every particle inside the shape while running', async () => {
    const host = mountHost(300, 300);
    const field = track(
      createPlexure(host, {
        count: 100,
        seed: 3,
        maxDpr: 1,
        clipTo: { path: SQUARE, fit: 'none' },
        ...DOTS_ONLY,
      }),
    );

    await nextFrames(45);

    const points = positions(field);
    const inside = makeTester(SQUARE);
    const strays = points.filter(([x, y]) => !inside(x, y));
    expect(points.length).toBeGreaterThan(0);
    expect(strays).toEqual([]);
  });

  it('holds particles in under a fast drift that would otherwise escape', async () => {
    const host = mountHost(300, 300);
    const field = track(
      createPlexure(host, {
        count: 60,
        seed: 9,
        maxDpr: 1,
        // Fast enough to cross the whole square in a handful of frames.
        drift: [6, 9],
        clipTo: { path: SQUARE, fit: 'none' },
        ...DOTS_ONLY,
      }),
    );

    await nextFrames(40);

    const inside = makeTester(SQUARE);
    expect(positions(field).filter(([x, y]) => !inside(x, y))).toEqual([]);
  });

  it.each(['wrap', 'respawn', 'fade'] as const)(
    'contains particles with edgeBehaviour %s',
    async (edgeBehaviour) => {
      const host = mountHost(300, 300);
      const field = track(
        createPlexure(host, {
          count: 60,
          seed: 4,
          maxDpr: 1,
          drift: [3, 5],
          edgeBehaviour,
          clipTo: { path: SQUARE, fit: 'none' },
          ...DOTS_ONLY,
        }),
      );

      await nextFrames(30);

      const inside = makeTester(SQUARE);
      expect(positions(field).filter(([x, y]) => !inside(x, y))).toEqual([]);
    },
  );

  /**
   * `wrap` re-places particles inside the shape, and thin extremities lose particles faster
   * than the body does — so occupancy drifts inward and settles somewhat below uniform.
   * Measured on a star it stabilises around a 0.35 outer share rather than collapsing.
   * This guards the "settles" half: the points of a shape must stay populated.
   */
  it('does not bunch toward the centre of a spiky shape', async () => {
    const STAR = 'M 50 3 L 61 38 L 98 38 L 68 60 L 79 95 L 50 73 L 21 95 L 32 60 L 2 38 L 39 38 Z';
    const host = mountHost(400, 400);
    const field = track(
      createPlexure(host, {
        count: 300,
        seed: 5,
        maxDpr: 1,
        drift: [1.5, 3],
        pauseWhenOffscreen: false,
        clipTo: { path: STAR, fit: 'contain' },
        ...DOTS_ONLY,
      }),
    );

    const outerShare = () => {
      const points = positions(field);
      field.resume();
      const outer = points.filter(([x, y]) => Math.hypot(x - 200, y - 200) > 100);
      return outer.length / points.length;
    };

    const atStart = outerShare();
    await nextFrames(60);
    await nextFrames(240);
    const settled = outerShare();

    expect(atStart).toBeGreaterThan(0.3);
    // Some inward drift is expected; a collapse toward the middle is not.
    expect(settled).toBeGreaterThan(0.2);
  });

  it('stays inside the shape after a resize', async () => {
    const host = mountHost(300, 300);
    const field = track(
      createPlexure(host, {
        count: 80,
        seed: 6,
        maxDpr: 1,
        clipTo: { path: SQUARE, fit: 'contain' },
        ...DOTS_ONLY,
      }),
    );
    host.style.width = '600px';
    host.style.height = '400px';
    await nextFrames(2);
    field.refresh();
    await nextFrames(5);

    // 'contain' onto 600x400 from a 100x100 box at 100,100: scale 4, centred.
    const m = new DOMMatrix([4, 0, 0, 4, (600 - 400) / 2 - 400, (400 - 400) / 2 - 400]);
    const inside = makeTester(SQUARE, m);
    expect(positions(field).filter(([x, y]) => !inside(x, y))).toEqual([]);
  });
});

describe('sim-aware shape: the pointer follows the shape, not the box', () => {
  /** Links drawn from a particle back to the pointer, identified by the terminating lineTo. */
  function cursorLinks(field: PlexureInstance, host: HTMLElement, px: number, py: number): number {
    const r = host.getBoundingClientRect();
    host.dispatchEvent(
      new PointerEvent('pointermove', { clientX: r.left + px, clientY: r.top + py, bubbles: true }),
    );
    field.pause();
    const proto = CanvasRenderingContext2D.prototype;
    const original = proto.lineTo;
    const ends: Array<[number, number]> = [];
    proto.lineTo = function (this: CanvasRenderingContext2D, x: number, y: number) {
      ends.push([x, y]);
      return original.call(this, x, y);
    };
    try {
      field.refresh();
    } finally {
      proto.lineTo = original;
    }
    return ends.filter(([x, y]) => Math.abs(x - px) < 0.01 && Math.abs(y - py) < 0.01).length;
  }

  function hovering(host: HTMLElement, x: number, y: number) {
    const r = host.getBoundingClientRect();
    host.dispatchEvent(
      new PointerEvent('pointerenter', { clientX: r.left + x, clientY: r.top + y }),
    );
  }

  // The host element stays a rectangle, so without an explicit test the corners outside the
  // shape still pull — dragging particles toward a point they can never reach, which reads
  // as the field twitching at nothing.
  it('does not react to a pointer outside the shape', () => {
    const host = mountHost(300, 300);
    const field = track(
      createPlexure(host, {
        count: 120,
        seed: 2,
        maxDpr: 1,
        clipTo: { path: SQUARE, fit: 'none' },
      }),
    );
    hovering(host, 150, 150);
    expect(cursorLinks(field, host, 150, 150)).toBeGreaterThan(0);
    // Just outside the square, but well within link distance of its particles.
    expect(cursorLinks(field, host, 150, 60)).toBe(0);
    expect(cursorLinks(field, host, 60, 150)).toBe(0);
    expect(cursorLinks(field, host, 10, 10)).toBe(0);
  });

  it('reacts everywhere inside the shape and nowhere outside it', () => {
    const host = mountHost(300, 300);
    const field = track(
      createPlexure(host, {
        count: 140,
        seed: 8,
        maxDpr: 1,
        clipTo: { path: SQUARE, fit: 'none' },
      }),
    );
    hovering(host, 150, 150);

    const inside: number[] = [];
    const outside: number[] = [];
    for (let x = 20; x < 300; x += 20) {
      for (let y = 20; y < 300; y += 20) {
        const links = cursorLinks(field, host, x, y);
        (x >= 100 && x <= 200 && y >= 100 && y <= 200 ? inside : outside).push(links);
      }
    }
    expect(inside.length).toBeGreaterThan(4);
    expect(outside.length).toBeGreaterThan(20);
    expect(Math.min(...inside)).toBeGreaterThan(0);
    expect(Math.max(...outside)).toBe(0);
  });

  it('still reacts across the whole box for a mask-only clip', () => {
    const host = mountHost(300, 300);
    const field = track(
      createPlexure(host, { count: 120, seed: 2, maxDpr: 1, clipTo: new Path2D(SQUARE) }),
    );
    hovering(host, 30, 30);
    // A bare Path2D masks the render only, so the hover region stays the whole rectangle.
    expect(cursorLinks(field, host, 30, 30)).toBeGreaterThan(0);
  });
});

describe('sim-aware shape: density counts the shape, not the box', () => {
  // A shape covering half its container should hold half as many particles at the same
  // `density`, or the same settings render dramatically denser inside a shape than out.
  const HALF = 'M 0 0 H 300 V 150 H 0 Z';

  it('halves the count for a shape covering half the container', () => {
    const boxHost = mountHost(300, 300);
    const shapeHost = mountHost(300, 300);
    const box = still(boxHost, { density: 1000, ...DOTS_ONLY });
    const shaped = still(shapeHost, {
      density: 1000,
      clipTo: { path: HALF, fit: 'none' },
      ...DOTS_ONLY,
    });

    // 300*300/1000 = 90 against 300*150/1000 = 45.
    expect(positions(box)).toHaveLength(90);
    expect(positions(shaped).length).toBeGreaterThan(35);
    expect(positions(shaped).length).toBeLessThan(56);
  });

  it('leaves a mask-only clip counting the whole box', () => {
    const host = mountHost(300, 300);
    const field = still(host, { density: 1000, clipTo: new Path2D(HALF), ...DOTS_ONLY });
    expect(positions(field)).toHaveLength(90);
  });

  it('still honours an explicit count inside a shape', () => {
    const host = mountHost(300, 300);
    const field = still(host, {
      count: 70,
      density: 1000,
      clipTo: { path: HALF, fit: 'none' },
      ...DOTS_ONLY,
    });
    expect(positions(field)).toHaveLength(70);
  });
});

describe('sim-aware shape: fit', () => {
  function extent(field: PlexureInstance) {
    const points = positions(field);
    return {
      minX: Math.min(...points.map((p) => p[0])),
      maxX: Math.max(...points.map((p) => p[0])),
      minY: Math.min(...points.map((p) => p[1])),
      maxY: Math.max(...points.map((p) => p[1])),
      count: points.length,
    };
  }

  it("'contain' scales the shape up to fill the container", () => {
    const host = mountHost(400, 400);
    const field = still(host, { count: 200, clipTo: { path: SQUARE }, ...DOTS_ONLY });
    // The 100x100 box scales by 4 into 400x400 and is centred, so it spans the whole box.
    const e = extent(field);
    expect(e.minX).toBeLessThan(40);
    expect(e.maxX).toBeGreaterThan(360);
    expect(e.minY).toBeLessThan(40);
    expect(e.maxY).toBeGreaterThan(360);
  });

  it("'contain' preserves aspect ratio in a non-square container", () => {
    const host = mountHost(600, 300);
    const field = still(host, { count: 200, clipTo: { path: SQUARE }, ...DOTS_ONLY });
    const e = extent(field);
    // Scale is limited by height: 300/100 = 3, so a 300-wide square centred in 600.
    expect(e.minX).toBeGreaterThan(140);
    expect(e.maxX).toBeLessThan(460);
    expect(e.minY).toBeLessThan(20);
    expect(e.maxY).toBeGreaterThan(280);
  });

  it("'cover' fills the container's larger axis", () => {
    const host = mountHost(600, 300);
    const field = still(host, {
      count: 200,
      clipTo: { path: SQUARE, fit: 'cover' },
      ...DOTS_ONLY,
    });
    const e = extent(field);
    // Scale is driven by width: 600/100 = 6, so the square overflows vertically and is
    // clipped by the container.
    expect(e.minX).toBeLessThan(20);
    expect(e.maxX).toBeGreaterThan(580);
  });

  // 'cover' deliberately overflows the container, so the shape's bounding box extends past
  // what the canvas can show. Seeding across the whole shape box would throw away every
  // particle that landed in the overflow — on a 600x300 container, about half of them.
  it("'cover' seeds every particle where it can actually be seen", () => {
    const host = mountHost(600, 300);
    const field = still(host, {
      count: 200,
      clipTo: { path: SQUARE, fit: 'cover' },
      ...DOTS_ONLY,
    });
    const points = positions(field);
    expect(points).toHaveLength(200);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(600);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(300);
    }
  });

  it("'cover' keeps particles in view while running", async () => {
    const host = mountHost(600, 300);
    const field = track(
      createPlexure(host, {
        count: 120,
        seed: 15,
        maxDpr: 1,
        drift: [4, 7],
        clipTo: { path: SQUARE, fit: 'cover' },
        ...DOTS_ONLY,
      }),
    );

    await nextFrames(40);

    // A particle can be inside the shape and outside the container at once here; drifting
    // into that overflow must not strand it invisibly.
    const strays = positions(field).filter(([x, y]) => x < 0 || x > 600 || y < 0 || y > 300);
    expect(strays).toEqual([]);
  });

  it("'none' uses the path's own coordinates", () => {
    const host = mountHost(400, 400);
    const field = still(host, {
      count: 120,
      clipTo: { path: SQUARE, fit: 'none' },
      ...DOTS_ONLY,
    });
    const e = extent(field);
    expect(e.minX).toBeGreaterThanOrEqual(100);
    expect(e.maxX).toBeLessThanOrEqual(200);
    expect(e.minY).toBeGreaterThanOrEqual(100);
    expect(e.maxY).toBeLessThanOrEqual(200);
  });

  it('accepts a Path2D with an explicit viewBox', () => {
    const host = mountHost(400, 400);
    const path = new Path2D(SQUARE);
    const field = still(host, {
      count: 150,
      clipTo: { path, viewBox: [100, 100, 100, 100], fit: 'contain' },
      ...DOTS_ONLY,
    });
    const e = extent(field);
    expect(e.minX).toBeLessThan(40);
    expect(e.maxX).toBeGreaterThan(360);
  });

  it('falls back to raw coordinates for a Path2D with no viewBox', () => {
    const host = mountHost(400, 400);
    const field = still(host, {
      count: 120,
      clipTo: { path: new Path2D(SQUARE) },
      ...DOTS_ONLY,
    });
    const e = extent(field);
    // No bounds are discoverable for a Path2D, so it cannot be fitted and is used as-is.
    expect(e.minX).toBeGreaterThanOrEqual(100);
    expect(e.maxX).toBeLessThanOrEqual(200);
  });
});

describe('sim-aware shape: rendering', () => {
  it('paints only inside the shape', () => {
    const host = mountHost(300, 300);
    still(host, { count: 150, clipTo: { path: SQUARE, fit: 'none' }, ...DOTS_ONLY });
    const s = sample(canvasIn(host));
    expect(s.painted).toBeGreaterThan(0);
    expect(s.bounds.minX).toBeGreaterThanOrEqual(97);
    expect(s.bounds.maxX).toBeLessThanOrEqual(203);
    expect(s.bounds.minY).toBeGreaterThanOrEqual(97);
    expect(s.bounds.maxY).toBeLessThanOrEqual(203);
  });

  it('does not set a CSS clip-path for the object form', () => {
    const host = mountHost(300, 300);
    still(host, { clipTo: { path: SQUARE, fit: 'none' } });
    expect(canvasIn(host).style.clipPath).toBe('');
  });
});

describe('sim-aware shape: degrades safely', () => {
  const cases: Array<[string, ShapeClip]> = [
    ['empty path data', { path: '' }],
    ['malformed path data', { path: 'not a path' }],
    ['zero-area path', { path: 'M 10 10 L 20 10 Z' }],
    ['path entirely outside the container', { path: 'M 900 900 H 950 V 950 H 900 Z', fit: 'none' }],
    ['degenerate viewBox', { path: SQUARE, viewBox: [0, 0, 0, 0] }],
  ];

  it.each(cases)('survives %s', (_name, clipTo) => {
    const host = mountHost(300, 300);
    let field!: PlexureInstance;
    expect(() => {
      field = track(createPlexure(host, { count: 40, maxDpr: 1, clipTo, ...DOTS_ONLY }));
    }).not.toThrow();
    // Whatever it decided, it must still be a working handle.
    expect(() => {
      field.refresh();
      field.pause();
      field.resume();
    }).not.toThrow();
  });

  it('keeps rendering a field when the shape cannot be sampled', () => {
    const host = mountHost(300, 300);
    // Entirely outside the container: nothing can be seeded inside it.
    const field = still(host, {
      count: 60,
      clipTo: { path: 'M 900 900 H 950 V 950 H 900 Z', fit: 'none' },
      ...DOTS_ONLY,
    });
    // Degrades to masking alone rather than an empty field: particles exist again.
    expect(positions(field).length).toBeGreaterThan(0);
  });

  // Setting a shape pulls stranded particles in, because leaving them outside would render
  // them invisible behind the clip. Clearing one does not push anything out: those
  // positions are all still valid, and teleporting the field would read as a jump.
  it('stops confining particles once the clip is cleared', async () => {
    const host = mountHost(300, 300);
    const field = track(
      createPlexure(host, {
        count: 100,
        seed: 2,
        maxDpr: 1,
        drift: [4, 6],
        clipTo: { path: SQUARE, fit: 'none' },
        ...DOTS_ONLY,
      }),
    );
    await nextFrames(10);
    const inside = makeTester(SQUARE);
    expect(positions(field).filter(([x, y]) => !inside(x, y))).toEqual([]);

    field.setOptions({ clipTo: null });
    field.resume();
    await nextFrames(30);

    expect(positions(field).some(([x, y]) => !inside(x, y))).toBe(true);
  });

  it('switches from a mask-only Path2D to a sim-aware shape', () => {
    const host = mountHost(300, 300);
    const field = still(host, { count: 100, clipTo: new Path2D(SQUARE), ...DOTS_ONLY });
    // A bare Path2D clips the render only, so the sim still fills the box.
    expect(positions(field).some(([x]) => x < 100 || x > 200)).toBe(true);

    field.setOptions({ clipTo: { path: SQUARE, fit: 'none' } });
    const inside = makeTester(SQUARE);
    expect(positions(field).filter(([x, y]) => !inside(x, y))).toEqual([]);
  });
});
