import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlexure } from '../src/index';
import {
  canvasIn,
  cleanup,
  countCalls,
  countCallsOver,
  mountHost,
  particleCount,
  RESIZE_SETTLE_MS,
  stubReducedMotion,
  track,
  trackListeners,
  wait,
} from './helpers';

afterEach(cleanup);

describe('canvas', () => {
  it('appends a canvas to an element host', () => {
    const host = mountHost();
    track(createPlexure(host));
    expect(canvasIn(host).tagName).toBe('CANVAS');
  });

  // "The canvas never interferes" — these four are load-bearing for the whole pitch.
  it('is inert to pointers, hidden from assistive tech, and clipped to its box', () => {
    const host = mountHost();
    track(createPlexure(host));
    const canvas = canvasIn(host);
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(getComputedStyle(canvas).pointerEvents).toBe('none');
    expect(canvas.style.contain).toBe('strict');
    expect(canvas.style.display).toBe('block');
  });

  it('positions absolutely inside an element host', () => {
    const host = mountHost();
    track(createPlexure(host));
    expect(canvasIn(host).style.position).toBe('absolute');
  });

  it('positions fixed for a viewport field', () => {
    const field = track(createPlexure('viewport'));
    const canvas = document.body.querySelector('canvas');
    expect(canvas?.style.position).toBe('fixed');
    field.destroy();
  });

  it('sizes the backing store to the host box', () => {
    const host = mountHost(320, 240);
    track(createPlexure(host, { maxDpr: 1 }));
    const canvas = canvasIn(host);
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(240);
    expect(canvas.style.width).toBe('320px');
  });

  it('scales the backing store by the capped device pixel ratio', () => {
    const host = mountHost(320, 240);
    track(createPlexure(host, { maxDpr: 0.5 }));
    const canvas = canvasIn(host);
    expect(canvas.width).toBe(160);
    expect(canvas.style.width).toBe('320px');
  });

  it('applies zIndex and className', () => {
    const host = mountHost();
    track(createPlexure(host, { zIndex: 7, className: 'field-canvas' }));
    const canvas = canvasIn(host);
    expect(canvas.style.zIndex).toBe('7');
    expect(canvas.className).toBe('field-canvas');
  });

  it('applies a string clipTo as a CSS clip-path', () => {
    const host = mountHost();
    const field = track(createPlexure(host, { clipTo: 'circle(40%)' }));
    expect(canvasIn(host).style.clipPath).toBe('circle(40%)');
    field.setOptions({ clipTo: null });
    expect(canvasIn(host).style.clipPath).toBe('');
  });
});

describe('no 2D context available', () => {
  // A real browser can refuse a context (too many live canvases, a locked-down embedder).
  // The field must decline quietly rather than throw into the host page's render path.
  function withoutContext<T>(fn: () => T): T {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = () => null;
    try {
      return fn();
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  }

  it('returns an inert handle instead of throwing', () => {
    const host = mountHost();
    const field = withoutContext(() => createPlexure(host));
    expect(field.isRunning).toBe(false);
    expect(() => {
      field.setOptions({ count: 5 });
      field.refresh();
      field.destroy();
    }).not.toThrow();
  });

  it('leaves the host untouched', () => {
    const host = mountHost();
    withoutContext(() => createPlexure(host));
    expect(host.querySelector('canvas')).toBeNull();
    expect(host.style.position).toBe('');
  });
});

describe('host positioning', () => {
  it('promotes a statically-positioned host to relative', () => {
    const host = mountHost();
    expect(getComputedStyle(host).position).toBe('static');
    track(createPlexure(host));
    expect(host.style.position).toBe('relative');
  });

  it('restores the host position on destroy', () => {
    const host = mountHost();
    const field = createPlexure(host);
    field.destroy();
    expect(host.style.position).toBe('');
  });

  it('leaves an already-positioned host alone', () => {
    const host = mountHost(400, 300, { position: 'absolute' });
    const field = createPlexure(host);
    expect(host.style.position).toBe('absolute');
    field.destroy();
    // Not ours to clear — we never set it.
    expect(host.style.position).toBe('absolute');
  });
});

describe('particle count', () => {
  it('derives the count from area and density', () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { density: 2000, maxDpr: 1 }));
    // 400 * 300 / 2000 = 60
    expect(particleCount(field)).toBe(60);
  });

  it('clamps a sparse field up to minCount', () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { density: 1e9, minCount: 24 }));
    expect(particleCount(field)).toBe(24);
  });

  it('clamps a dense field down to maxCount', () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { density: 100, maxCount: 160 }));
    expect(particleCount(field)).toBe(160);
  });

  it('lets an explicit count override density and the clamps', () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 37, density: 100, maxCount: 160 }));
    expect(particleCount(field)).toBe(37);
  });

  it('draws nothing in a zero-size container', () => {
    const host = mountHost(0, 0);
    const field = track(createPlexure(host));
    expect(field.isRunning).toBe(false);
    expect(particleCount(field)).toBe(0);
  });

  it('applies a new count through setOptions', () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 20 }));
    expect(particleCount(field)).toBe(20);
    field.setOptions({ count: 45 });
    expect(particleCount(field)).toBe(45);
  });
});

describe('resize', () => {
  it('re-derives a density-driven count for the new box', async () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { density: 2000, maxDpr: 1 }));
    expect(particleCount(field)).toBe(60);

    host.style.height = '600px';
    field.resume();
    await wait(RESIZE_SETTLE_MS);

    // 400 * 600 / 2000 = 120
    expect(particleCount(field)).toBe(120);
  });

  it('preserves an explicit count across a resize', async () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 33 }));
    host.style.width = '700px';
    field.resume();
    await wait(RESIZE_SETTLE_MS);
    expect(particleCount(field)).toBe(33);
  });

  it('follows the host box into the new size', async () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { maxDpr: 1 }));
    host.style.width = '250px';
    field.resume();
    await wait(RESIZE_SETTLE_MS);
    expect(canvasIn(host).width).toBe(250);
  });
});

describe('lifecycle', () => {
  it('runs on creation', () => {
    const host = mountHost();
    expect(track(createPlexure(host)).isRunning).toBe(true);
  });

  it('stops and restarts with pause and resume', () => {
    const host = mountHost();
    const field = track(createPlexure(host));
    field.pause();
    expect(field.isRunning).toBe(false);
    field.resume();
    expect(field.isRunning).toBe(true);
  });

  it('renders one still frame when paused, then nothing', async () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 10 }));
    const onPause = countCalls('arc', () => field.pause());
    expect(onPause).toBe(10);
    expect(await countCallsOver('arc', 120)).toBe(0);
  });

  it('keeps drawing while running', async () => {
    const host = mountHost(400, 300);
    track(createPlexure(host, { count: 10 }));
    expect(await countCallsOver('clearRect', 120)).toBeGreaterThan(2);
  });

  it('is idempotent on destroy', () => {
    const host = mountHost();
    const field = createPlexure(host);
    field.destroy();
    expect(() => field.destroy()).not.toThrow();
  });

  it('ignores setOptions and refresh after destroy', () => {
    const host = mountHost();
    const field = createPlexure(host);
    field.destroy();
    expect(() => {
      field.setOptions({ density: 1 });
      field.refresh();
    }).not.toThrow();
    expect(field.isRunning).toBe(false);
  });

  it('removes the canvas on destroy', () => {
    const host = mountHost();
    const field = createPlexure(host);
    expect(host.querySelector('canvas')).not.toBeNull();
    field.destroy();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('disconnects both observers on destroy', () => {
    const roSpy = vi.spyOn(ResizeObserver.prototype, 'disconnect');
    const ioSpy = vi.spyOn(IntersectionObserver.prototype, 'disconnect');
    const host = mountHost();
    const field = createPlexure(host, { pauseWhenOffscreen: true });
    field.destroy();
    expect(roSpy).toHaveBeenCalled();
    expect(ioSpy).toHaveBeenCalled();
    roSpy.mockRestore();
    ioSpy.mockRestore();
  });

  it('stops the ticker on destroy', async () => {
    const host = mountHost(400, 300);
    const field = createPlexure(host, { count: 10 });
    field.destroy();
    expect(await countCallsOver('clearRect', 120)).toBe(0);
  });
});

describe('reduced motion', () => {
  it('does not run, and renders exactly one still frame', async () => {
    const restore = stubReducedMotion(true);
    try {
      const host = mountHost(400, 300);
      let field!: ReturnType<typeof createPlexure>;
      const onCreate = countCalls('arc', () => {
        field = track(createPlexure(host, { count: 12 }));
      });
      expect(field.isRunning).toBe(false);
      expect(onCreate).toBe(12);
      expect(await countCallsOver('arc', 120)).toBe(0);
    } finally {
      restore();
    }
  });

  it('renders nothing at all when reducedMotion is "none"', () => {
    const restore = stubReducedMotion(true);
    try {
      const host = mountHost(400, 300);
      const drawn = countCalls('arc', () =>
        track(createPlexure(host, { count: 12, reducedMotion: 'none' })),
      );
      expect(drawn).toBe(0);
    } finally {
      restore();
    }
  });

  it('runs normally when the preference is opted out of', () => {
    const restore = stubReducedMotion(true);
    try {
      const host = mountHost(400, 300);
      const field = track(createPlexure(host, { respectReducedMotion: false }));
      expect(field.isRunning).toBe(true);
    } finally {
      restore();
    }
  });
});

describe('listener hygiene', () => {
  // Guards the three tests below from silently becoming vacuous: if the tracker ever stops
  // observing, this fails first and says so.
  it('the tracker itself detects an unreturned listener', () => {
    const tracker = trackListeners();
    try {
      const before = tracker.snapshot();
      const el = mountHost();
      const fn = () => {};
      el.addEventListener('click', fn);
      expect(tracker.leakedSince(before)).toHaveLength(1);
      el.removeEventListener('click', fn);
      expect(tracker.leakedSince(before)).toEqual([]);
    } finally {
      tracker.stop();
    }
  });

  it('returns every listener it took', async () => {
    const tracker = trackListeners();
    try {
      const before = tracker.snapshot();
      const host = mountHost();
      const field = createPlexure(host);
      field.destroy();
      expect(tracker.leakedSince(before)).toEqual([]);
    } finally {
      tracker.stop();
    }
  });

  it('returns every listener for a viewport field too', async () => {
    const tracker = trackListeners();
    try {
      const before = tracker.snapshot();
      const field = createPlexure('viewport');
      field.destroy();
      expect(tracker.leakedSince(before)).toEqual([]);
    } finally {
      tracker.stop();
    }
  });

  it('returns every listener for a page field too', async () => {
    const tracker = trackListeners();
    try {
      const before = tracker.snapshot();
      const field = createPlexure('page');
      field.destroy();
      expect(tracker.leakedSince(before)).toEqual([]);
    } finally {
      tracker.stop();
    }
  });
});
