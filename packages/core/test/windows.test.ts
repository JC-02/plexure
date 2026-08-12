import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlexure } from '../src/index';
import type { PlexureInput, PlexureInstance } from '../src/types';
import { RESIZE_SETTLE_MS, canvasIn, cleanup, mountHost, sample, track, wait } from './helpers';

afterEach(cleanup);

/** Links off so painted pixels track particle positions rather than link geometry. */
const DOTS_ONLY: PlexureInput = { link: { opacity: 0 }, cursor: { enabled: false } };

/** A window at a fixed offset inside the host, sized and rounded as given. */
function addWindow(
  host: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
  radius = '0px',
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'win';
  el.style.cssText =
    `position:absolute;left:${left}px;top:${top}px;` +
    `width:${width}px;height:${height}px;border-radius:${radius}`;
  host.appendChild(el);
  return el;
}

function still(host: HTMLElement, options: PlexureInput = {}): PlexureInstance {
  const field = track(createPlexure(host, { maxDpr: 1, seed: 4, count: 400, ...options }));
  field.pause();
  return field;
}

/** Painted pixels inside a rectangle of the canvas. */
function paintedIn(
  canvas: HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) painted++;
  return painted;
}

describe('window clip: masking', () => {
  it('paints inside a window and nowhere else', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    addWindow(host, 40, 40, 120, 100);
    still(host, { clipTo: { windows: '.win' }, ...DOTS_ONLY });

    const canvas = canvasIn(host);
    expect(paintedIn(canvas, 42, 42, 158, 138)).toBeGreaterThan(0);
    // Everything outside that one window must be untouched.
    expect(paintedIn(canvas, 0, 0, 400, 38)).toBe(0);
    expect(paintedIn(canvas, 0, 142, 400, 300)).toBe(0);
    expect(paintedIn(canvas, 0, 0, 38, 300)).toBe(0);
    expect(paintedIn(canvas, 162, 0, 400, 300)).toBe(0);
  });

  it('shows through several windows and leaves the gaps empty', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    addWindow(host, 20, 100, 100, 100);
    addWindow(host, 150, 100, 100, 100);
    addWindow(host, 280, 100, 100, 100);
    still(host, { clipTo: { windows: '.win' }, ...DOTS_ONLY });

    const canvas = canvasIn(host);
    expect(paintedIn(canvas, 22, 102, 118, 198)).toBeGreaterThan(0);
    expect(paintedIn(canvas, 152, 102, 248, 198)).toBeGreaterThan(0);
    expect(paintedIn(canvas, 282, 102, 378, 198)).toBeGreaterThan(0);
    // The gaps between them show nothing.
    expect(paintedIn(canvas, 122, 100, 148, 200)).toBe(0);
    expect(paintedIn(canvas, 252, 100, 278, 200)).toBe(0);
  });

  it('accepts an element array as well as a selector', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    const first = addWindow(host, 20, 100, 100, 100);
    addWindow(host, 150, 100, 100, 100);
    still(host, { clipTo: { windows: [first] }, ...DOTS_ONLY });

    const canvas = canvasIn(host);
    expect(paintedIn(canvas, 22, 102, 118, 198)).toBeGreaterThan(0);
    // The second window was not listed, so nothing shows through it.
    expect(paintedIn(canvas, 152, 102, 248, 198)).toBe(0);
  });

  it('rounds the corners to match the CSS', () => {
    const square = mountHost(400, 300, { position: 'relative' });
    const round = mountHost(400, 300, { position: 'relative' });
    addWindow(square, 40, 40, 200, 200, '0px');
    // A 100px radius on a 200px box is a circle inscribed in the square.
    addWindow(round, 40, 40, 200, 200, '100px');
    // Dense, so the corner regions below hold particles rather than happening to be empty.
    still(square, { clipTo: { windows: '.win' }, count: 1200, ...DOTS_ONLY });
    still(round, { clipTo: { windows: '.win' }, count: 1200, ...DOTS_ONLY });

    // The corner region sits inside the square window and entirely outside the circle.
    expect(paintedIn(canvasIn(square), 41, 41, 68, 68)).toBeGreaterThan(0);
    expect(paintedIn(canvasIn(round), 41, 41, 68, 68)).toBe(0);

    // Across the whole window box, a circle covers pi/4 of a square, so it paints less.
    const sharp = paintedIn(canvasIn(square), 40, 40, 240, 240);
    const rounded = paintedIn(canvasIn(round), 40, 40, 240, 240);
    expect(sharp).toBeGreaterThan(0);
    expect(rounded).toBeLessThan(sharp * 0.9);
    expect(rounded).toBeGreaterThan(sharp * 0.5);
  });

  it('reads each corner separately', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    const win = addWindow(host, 40, 40, 200, 200);
    // Only the top-left corner is rounded.
    win.style.borderRadius = '90px 0 0 0';
    still(host, { clipTo: { windows: '.win' }, count: 1200, ...DOTS_ONLY });

    const canvas = canvasIn(host);
    expect(paintedIn(canvas, 41, 41, 62, 62)).toBe(0);
    // The other three corners keep their square edges.
    expect(paintedIn(canvas, 218, 41, 239, 62)).toBeGreaterThan(0);
    expect(paintedIn(canvas, 41, 218, 62, 239)).toBeGreaterThan(0);
    expect(paintedIn(canvas, 218, 218, 239, 239)).toBeGreaterThan(0);
  });

  it('merges overlapping windows without a seam', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    addWindow(host, 50, 50, 150, 150);
    addWindow(host, 150, 50, 150, 150);
    still(host, { clipTo: { windows: '.win' }, ...DOTS_ONLY });

    // The overlap paints like any other part of the union, rather than cancelling out.
    expect(paintedIn(canvasIn(host), 155, 55, 195, 195)).toBeGreaterThan(0);
  });
});

describe('window clip: the field stays continuous', () => {
  // The whole point of windows over separate fields: one simulation spans the wrapper and
  // shows through the apertures, so a particle leaving one window reappears in the next.
  it('does not confine the simulation to the windows', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    addWindow(host, 20, 100, 100, 100);
    const field = still(host, { clipTo: { windows: '.win' }, count: 200, ...DOTS_ONLY });

    const points: Array<[number, number]> = [];
    const proto = CanvasRenderingContext2D.prototype;
    const original = proto.arc;
    proto.arc = function (this: CanvasRenderingContext2D, x: number, y: number, ...rest) {
      points.push([x, y]);
      return original.call(this, x, y, ...(rest as [number, number, number, boolean?]));
    };
    try {
      field.refresh();
    } finally {
      proto.arc = original;
    }

    expect(points).toHaveLength(200);
    // Most particles live outside the single window; they are masked, not moved.
    const outside = points.filter(([x, y]) => x < 20 || x > 120 || y < 100 || y > 200);
    expect(outside.length).toBeGreaterThan(100);
  });

  it('counts density against the whole host, not the windows', () => {
    const bare = mountHost(400, 300, { position: 'relative' });
    const windowed = mountHost(400, 300, { position: 'relative' });
    addWindow(windowed, 20, 20, 60, 60);

    const countOf = (field: PlexureInstance) => {
      field.pause();
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.arc;
      let n = 0;
      proto.arc = function (this: CanvasRenderingContext2D, ...args: never[]) {
        n++;
        return (original as (...a: never[]) => void).apply(this, args);
      };
      try {
        field.refresh();
      } finally {
        proto.arc = original;
      }
      return n;
    };

    const a = still(bare, { count: undefined, density: 2000, ...DOTS_ONLY });
    const b = still(windowed, {
      count: undefined,
      density: 2000,
      clipTo: { windows: '.win' },
      ...DOTS_ONLY,
    });
    expect(countOf(b)).toBe(countOf(a));
  });
});

describe('window clip: staying fresh', () => {
  /**
   * The host keeps its size here, so only the window's own observer can notice. Asserting
   * on the gap between two windows rather than on the window itself is what makes this
   * bite: a stale mask still covers ground the shrunken window has given up.
   */
  it('rebuilds the mask when a window resizes but the host does not', async () => {
    const host = mountHost(400, 300, { position: 'relative' });
    const first = addWindow(host, 20, 60, 160, 160);
    addWindow(host, 220, 60, 160, 160);
    const field = track(
      createPlexure(host, {
        maxDpr: 1,
        seed: 4,
        count: 900,
        clipTo: { windows: '.win' },
        ...DOTS_ONLY,
      }),
    );

    // Let the observer's initial callback and its debounce drain first. Without this the
    // construction-time resize lands after the width change below and rebuilds the mask by
    // coincidence, hiding whether the window's own observer did anything.
    await wait(RESIZE_SETTLE_MS);

    // pause() renders a still frame; a running field has drawn nothing yet.
    field.pause();
    expect(paintedIn(canvasIn(host), 30, 70, 170, 210)).toBeGreaterThan(0);
    expect(paintedIn(canvasIn(host), 184, 70, 216, 210)).toBe(0);

    // Absolutely positioned, so shrinking the first does not move the second.
    field.resume();
    first.style.width = '80px';
    await wait(RESIZE_SETTLE_MS);
    field.pause();

    expect(host.clientWidth).toBe(400);
    expect(host.clientHeight).toBe(300);
    // Ground the first window gave up. A stale mask would still be painting here.
    expect(paintedIn(canvasIn(host), 110, 70, 210, 210)).toBe(0);
    // What it still covers keeps painting.
    expect(paintedIn(canvasIn(host), 30, 70, 90, 210)).toBeGreaterThan(0);
  });

  it('observes the windows, not only the host', () => {
    const spy = vi.spyOn(ResizeObserver.prototype, 'observe');
    const host = mountHost(400, 300, { position: 'relative' });
    const win = addWindow(host, 40, 40, 80, 80);
    track(createPlexure(host, { clipTo: { windows: '.win' } }));
    expect(spy.mock.calls.some(([el]) => el === win)).toBe(true);
    spy.mockRestore();
  });

  it('stops observing windows once the clip changes', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    const win = addWindow(host, 40, 40, 80, 80);
    const field = track(createPlexure(host, { clipTo: { windows: '.win' } }));

    const spy = vi.spyOn(ResizeObserver.prototype, 'unobserve');
    field.setOptions({ clipTo: null });
    expect(spy.mock.calls.some(([el]) => el === win)).toBe(true);
    spy.mockRestore();
  });

  it('releases the window observers on destroy', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    addWindow(host, 40, 40, 80, 80);
    const field = createPlexure(host, { clipTo: { windows: '.win' } });
    const spy = vi.spyOn(ResizeObserver.prototype, 'disconnect');
    field.destroy();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  /**
   * A ResizeObserver reports size, not position. A window that moves without resizing is
   * invisible to it, so `refresh()` is the documented escape hatch. This pins both halves:
   * the mask does go stale, and refresh() fixes it.
   */
  it('needs refresh() for a window that moves without resizing', async () => {
    const host = mountHost(400, 300, { position: 'relative' });
    const win = addWindow(host, 20, 60, 120, 120);
    const field = track(
      createPlexure(host, {
        maxDpr: 1,
        seed: 4,
        count: 900,
        clipTo: { windows: '.win' },
        ...DOTS_ONLY,
      }),
    );
    await wait(RESIZE_SETTLE_MS);
    field.pause();
    expect(paintedIn(canvasIn(host), 30, 70, 130, 170)).toBeGreaterThan(0);

    // Same size, new place. Nothing resizes, so no observer fires.
    win.style.left = '250px';
    field.resume();
    await wait(RESIZE_SETTLE_MS);
    field.pause();
    expect(paintedIn(canvasIn(host), 260, 70, 360, 170)).toBe(0);

    field.refresh();
    expect(paintedIn(canvasIn(host), 260, 70, 360, 170)).toBeGreaterThan(0);
    expect(paintedIn(canvasIn(host), 30, 70, 130, 170)).toBe(0);
  });

  it('picks up windows added after the field mounted', async () => {
    const host = mountHost(400, 300, { position: 'relative' });
    const field = track(
      createPlexure(host, { maxDpr: 1, seed: 4, count: 400, clipTo: { windows: '.win' }, ...DOTS_ONLY }),
    );
    field.pause();
    expect(sample(canvasIn(host)).painted).toBe(0);

    addWindow(host, 40, 40, 120, 100);
    field.refresh();

    expect(paintedIn(canvasIn(host), 42, 42, 158, 138)).toBeGreaterThan(0);
  });
});

describe('window clip: degrades safely', () => {
  // "Visible only through these windows" with no windows means nothing is visible. Painting
  // the full field instead would flash unmasked whenever the windows mount after the field.
  it('paints nothing when the selector matches nothing', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    still(host, { clipTo: { windows: '.nope' }, ...DOTS_ONLY });
    expect(sample(canvasIn(host)).painted).toBe(0);
  });

  it('paints nothing for an empty element array', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    still(host, { clipTo: { windows: [] }, ...DOTS_ONLY });
    expect(sample(canvasIn(host)).painted).toBe(0);
  });

  it('survives a selector that does not parse', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    let field!: PlexureInstance;
    expect(() => {
      field = track(createPlexure(host, { clipTo: { windows: ':::' } }));
    }).not.toThrow();
    expect(() => field.refresh()).not.toThrow();
  });

  it('ignores a window with no size', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    addWindow(host, 40, 40, 0, 0);
    addWindow(host, 200, 100, 120, 100);
    still(host, { clipTo: { windows: '.win' }, ...DOTS_ONLY });
    expect(paintedIn(canvasIn(host), 202, 102, 318, 198)).toBeGreaterThan(0);
  });

  it('sets no CSS clip-path for the window form', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    addWindow(host, 40, 40, 120, 100);
    still(host, { clipTo: { windows: '.win' } });
    expect(canvasIn(host).style.clipPath).toBe('');
  });

  it('clears back to an unmasked field', () => {
    const host = mountHost(400, 300, { position: 'relative' });
    addWindow(host, 40, 40, 120, 100);
    const field = still(host, { clipTo: { windows: '.win' }, ...DOTS_ONLY });
    expect(paintedIn(canvasIn(host), 200, 200, 400, 300)).toBe(0);

    field.setOptions({ clipTo: null });
    field.pause();
    field.refresh();
    expect(paintedIn(canvasIn(host), 200, 200, 400, 300)).toBeGreaterThan(0);
  });
});
