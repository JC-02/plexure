import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlexure } from '../src/index';
import { canvasIn, cleanup, countCallsOver, mountHost, track, wait } from './helpers';

afterEach(cleanup);

/**
 * The promises the README makes about never compromising a host page. Written as tests so
 * they are guarantees rather than claims: a field is decoration, and decoration that
 * breaks the page it decorates is worse than no decoration.
 */

/** Break the next N draws by making a context method throw. */
function breakDrawing(times = Number.POSITIVE_INFINITY): () => void {
  const proto = CanvasRenderingContext2D.prototype;
  const original = proto.clearRect;
  let left = times;
  proto.clearRect = function (this: CanvasRenderingContext2D, ...args: [number, number, number, number]) {
    if (left-- > 0) throw new Error('synthetic render failure');
    return original.apply(this, args);
  };
  return () => {
    proto.clearRect = original;
  };
}

describe('a failing field stops instead of wedging the page', () => {
  it('does not let a render error escape into the host', async () => {
    const host = mountHost(400, 300);
    track(createPlexure(host, { count: 20 }));
    const errors: string[] = [];
    const onError = (e: ErrorEvent) => errors.push(String(e.message));
    window.addEventListener('error', onError);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const restore = breakDrawing();
    try {
      await wait(150);
    } finally {
      restore();
      window.removeEventListener('error', onError);
      warn.mockRestore();
    }
    expect(errors).toEqual([]);
  });

  it('gives up after repeated failures rather than retrying forever', async () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 20 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = breakDrawing();
    try {
      await wait(200);
    } finally {
      restore();
    }
    expect(field.isRunning).toBe(false);
    // Drawing works again, but the field stays down until asked to come back.
    expect(await countCallsOver('arc', 120)).toBe(0);
    warn.mockRestore();
  });

  it('warns exactly once, however long it stays broken', async () => {
    const host = mountHost(400, 300);
    track(createPlexure(host, { count: 20 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = breakDrawing();
    try {
      await wait(400);
    } finally {
      restore();
    }
    // A field that logged every frame would bury everything else in the console.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('plexure');
    warn.mockRestore();
  });

  it('rides out a transient failure without giving up', async () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 20 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Fewer failures in a row than the limit, so the field recovers on its own.
    const restore = breakDrawing(2);
    await wait(200);
    restore();

    expect(field.isRunning).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(await countCallsOver('arc', 120)).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it('comes back on resume once the cause is fixed', async () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 20 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = breakDrawing();
    await wait(200);
    restore();
    expect(field.isRunning).toBe(false);

    field.resume();
    expect(field.isRunning).toBe(true);
    expect(await countCallsOver('arc', 120)).toBeGreaterThan(0);
    warn.mockRestore();
  });
});

describe('the canvas never interferes with the page', () => {
  it('cannot receive pointer events', () => {
    const host = mountHost();
    track(createPlexure(host));
    expect(getComputedStyle(canvasIn(host)).pointerEvents).toBe('none');
  });

  it('is hidden from assistive technology', () => {
    const host = mountHost();
    track(createPlexure(host));
    expect(canvasIn(host).getAttribute('aria-hidden')).toBe('true');
  });

  it('is not reachable by keyboard', () => {
    const host = mountHost();
    track(createPlexure(host));
    const canvas = canvasIn(host);
    expect(canvas.tabIndex).toBeLessThan(0);
    expect(canvas.hasAttribute('tabindex')).toBe(false);
  });

  it('never moves focus', async () => {
    const host = mountHost(400, 300);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    const field = track(createPlexure(host, { count: 20 }));
    host.dispatchEvent(new PointerEvent('pointerenter', { clientX: 10, clientY: 10 }));
    await wait(120);
    field.refresh();

    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('paints inside its own box and nowhere else', () => {
    const host = mountHost(320, 240);
    track(createPlexure(host, { maxDpr: 1 }));
    const canvas = canvasIn(host);
    // `contain: strict` plus an exact size keeps it from affecting layout around it.
    expect(canvas.style.contain).toBe('strict');
    expect(canvas.style.position).toBe('absolute');
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(240);
  });
});

describe('listeners are passive and returned', () => {
  it('registers no listener that can block scrolling', () => {
    const proto = EventTarget.prototype;
    const original = proto.addEventListener;
    const blocking: string[] = [];
    // Scroll-blocking types must never be registered without passive: true.
    const risky = new Set(['wheel', 'touchstart', 'touchmove', 'scroll', 'mousewheel']);
    proto.addEventListener = function (
      this: EventTarget,
      type: string,
      fn: unknown,
      opts: unknown,
    ) {
      const passive =
        typeof opts === 'object' && opts !== null && (opts as AddEventListenerOptions).passive;
      if (risky.has(type) && !passive) blocking.push(type);
      return original.call(this, type, fn as EventListener, opts as AddEventListenerOptions);
    } as typeof proto.addEventListener;

    try {
      track(createPlexure(mountHost()));
      track(createPlexure('viewport'));
      track(createPlexure('page'));
    } finally {
      proto.addEventListener = original;
    }
    expect(blocking).toEqual([]);
  });

  it('never calls preventDefault on a page event', async () => {
    const host = mountHost(400, 300);
    track(createPlexure(host, { count: 20 }));
    const move = new PointerEvent('pointermove', {
      clientX: 20,
      clientY: 20,
      bubbles: true,
      cancelable: true,
    });
    host.dispatchEvent(move);
    window.dispatchEvent(new Event('scroll', { cancelable: true }));
    await wait(60);
    expect(move.defaultPrevented).toBe(false);
  });
});

describe('the field reaches nothing outside itself', () => {
  it('writes nothing to storage or cookies', async () => {
    const localBefore = window.localStorage.length;
    const sessionBefore = window.sessionStorage.length;
    const cookieBefore = document.cookie;

    const field = track(createPlexure(mountHost(400, 300), { count: 30 }));
    await wait(150);
    field.setOptions({ intensity: 0.4 });

    expect(window.localStorage.length).toBe(localBefore);
    expect(window.sessionStorage.length).toBe(sessionBefore);
    expect(document.cookie).toBe(cookieBefore);
  });
});

describe('bad input degrades instead of throwing', () => {
  it.each([
    ['a negative count', { count: -5 }],
    ['a zero density', { density: 0 }],
    ['an unparseable colour', { star: { color: 'definitely-not-a-colour' } }],
    ['a negative link distance', { link: { distance: -50 } }],
    ['an out-of-range intensity', { intensity: 42 }],
    ['a nonsense percentage', { link: { distance: '%' as `${number}%` } }],
    ['a zero dpr cap', { maxDpr: 0 }],
    ['an inverted drift range', { drift: [9, 1] as [number, number] }],
  ])('survives %s', async (_label, options) => {
    const host = mountHost(400, 300);
    let field!: ReturnType<typeof createPlexure>;
    expect(() => {
      field = track(createPlexure(host, options));
    }).not.toThrow();
    expect(() => {
      field.refresh();
      field.pause();
      field.resume();
    }).not.toThrow();
    await wait(60);
  });

  /**
   * Smoke check only. The spatial-hash cell is normally the link distance, and an uncapped
   * 1 px cell builds one bucket per pixel: millions on a full-page field, rebuilt every
   * frame. Capping it measured 19 frames per 300 ms against 8 at 1200x900, but a 2.4x
   * margin is too thin to assert on without flaking, so the cap's correctness is pinned in
   * render.test.ts instead, where a larger cell must not change which pairs link.
   */
  it('keeps drawing with an absurdly small link distance', async () => {
    const host = mountHost(400, 300);
    track(
      createPlexure(host, {
        count: 120,
        clampDistances: false,
        link: { distance: 1 },
      }),
    );
    expect(await countCallsOver('clearRect', 250)).toBeGreaterThan(3);
  });

  it('survives a link distance larger than the container', async () => {
    const host = mountHost(400, 300);
    const field = track(
      createPlexure(host, { count: 60, clampDistances: false, link: { distance: 100000 } }),
    );
    expect(await countCallsOver('clearRect', 150)).toBeGreaterThan(2);
    expect(field.isRunning).toBe(true);
  });

  it('caps an enormous canvas rather than failing to allocate', () => {
    const host = mountHost(400, 300);
    // maxDpr is a cap, so a silly value must not produce a canvas the browser rejects.
    track(createPlexure(host, { maxDpr: 500 }));
    const canvas = canvasIn(host);
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.width).toBeLessThanOrEqual(32000);
    expect(canvas.height).toBeLessThanOrEqual(32000);
  });

  it('no-ops in a container with no size', () => {
    const host = mountHost(0, 0);
    const field = track(createPlexure(host));
    expect(field.isRunning).toBe(false);
    expect(() => field.refresh()).not.toThrow();
  });
});
