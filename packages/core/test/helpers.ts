import type { PlexureInstance } from '../src/types';

/**
 * The engine is a closure and exposes no internals on purpose, so these helpers observe it
 * the way a host page would: through the canvas it draws on and the listeners it registers.
 */

const hosts: HTMLElement[] = [];
const fields: PlexureInstance[] = [];

/** A positioned, sized host div, torn down automatically by `cleanup()`. */
export function mountHost(width = 400, height = 300, style: Partial<CSSStyleDeclaration> = {}) {
  const el = document.createElement('div');
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  Object.assign(el.style, style);
  document.body.appendChild(el);
  hosts.push(el);
  return el;
}

/** Register a field for automatic destruction, so no rAF loop leaks into the next test. */
export function track<T extends PlexureInstance>(field: T): T {
  fields.push(field);
  return field;
}

export function cleanup(): void {
  for (const f of fields.splice(0)) f.destroy();
  for (const h of hosts.splice(0)) h.remove();
}

export function canvasIn(host: Element): HTMLCanvasElement {
  const c = host.querySelector('canvas');
  if (!c) throw new Error('no canvas in host');
  return c as HTMLCanvasElement;
}

/* ------------------------------------------------------------------ draw probes */

type Ctx2D = CanvasRenderingContext2D;

/**
 * Count calls to a 2D context method while `fn` runs, by patching the prototype. Every
 * particle is drawn with exactly one `arc`, so `countCalls('arc', ...)` is a direct read of
 * the particle count without the engine having to expose it.
 */
export function countCalls(method: keyof Ctx2D, fn: () => void): number {
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
  const original = proto[method as string] as (...a: unknown[]) => unknown;
  let calls = 0;
  proto[method as string] = function (this: Ctx2D, ...args: unknown[]) {
    calls++;
    return original.apply(this, args);
  };
  try {
    fn();
  } finally {
    proto[method as string] = original;
  }
  return calls;
}

/**
 * Count calls to a 2D context method over a span of real time — the only way to assert
 * that a paused or destroyed field draws *nothing*, which needs frames to actually elapse.
 */
export async function countCallsOver(method: keyof Ctx2D, ms: number): Promise<number> {
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
  const original = proto[method as string] as (...a: unknown[]) => unknown;
  let calls = 0;
  proto[method as string] = function (this: Ctx2D, ...args: unknown[]) {
    calls++;
    return original.apply(this, args);
  };
  try {
    await wait(ms);
  } finally {
    proto[method as string] = original;
  }
  return calls;
}

/** Record the arguments of every call to a 2D context method while `fn` runs. */
export function recordCalls(method: keyof Ctx2D, fn: () => void): number[][] {
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
  const original = proto[method as string] as (...a: unknown[]) => unknown;
  const calls: number[][] = [];
  proto[method as string] = function (this: Ctx2D, ...args: unknown[]) {
    calls.push(args as number[]);
    return original.apply(this, args);
  };
  try {
    fn();
  } finally {
    proto[method as string] = original;
  }
  return calls;
}

/**
 * Render exactly one frame. The field is paused first so the shared ticker cannot slip an
 * extra frame in, then `refresh()` forces a single still render.
 */
export function drawOnce(field: PlexureInstance, fn: () => void = () => field.refresh()): void {
  field.pause();
  fn();
}

/** Particle count, read as the number of arcs drawn in one still frame. */
export function particleCount(field: PlexureInstance): number {
  field.pause();
  return countCalls('arc', () => field.refresh());
}

/**
 * Number of links drawn from a particle back to the pointer, identified by the lineTo that
 * terminates at the pointer's own coordinates — particle-to-particle links never do.
 */
export function cursorLinks(field: PlexureInstance, px: number, py: number): number {
  field.pause();
  const calls = recordCalls('lineTo', () => field.refresh());
  return calls.filter(([x, y]) => Math.abs(x - px) < 0.01 && Math.abs(y - py) < 0.01).length;
}

/* --------------------------------------------------------------- canvas sampling */

export interface CanvasSample {
  /** Pixels with meaningful alpha. */
  painted: number;
  centroid: { x: number; y: number };
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  width: number;
  height: number;
}

/**
 * Derived metrics rather than a pixel hash: these survive antialiasing differences between
 * platforms while still catching the regressions that matter — nothing drawn, wrong scale,
 * clip ignored, field drifting out of its box.
 */
export function sample(canvas: HTMLCanvasElement, alphaFloor = 8): CanvasSample {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let painted = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= alphaFloor) continue;
      painted++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return {
    painted,
    centroid: {
      x: painted ? sumX / painted : Number.NaN,
      y: painted ? sumY / painted : Number.NaN,
    },
    bounds: { minX, minY, maxX, maxY },
    width,
    height,
  };
}

/* ------------------------------------------------------------- listener tracking */

const ids = new WeakMap<object, number>();
let nextId = 1;
function idOf(fn: object): number {
  let id = ids.get(fn);
  if (id === undefined) {
    id = nextId++;
    ids.set(fn, id);
  }
  return id;
}

function keyFor(target: EventTarget, type: string, fn: unknown, opts: unknown): string {
  const capture = typeof opts === 'boolean' ? opts : !!(opts as AddEventListenerOptions)?.capture;
  const name =
    target === window
      ? 'window'
      : target === document
        ? 'document'
        : (target as Element).tagName || target.constructor.name;
  return `${name}|${type}|${idOf(fn as object)}|${capture}`;
}

/**
 * Track add/removeEventListener across every EventTarget. Comparing the outstanding set
 * before and after a field's lifetime proves `destroy()` gave back exactly what it took,
 * without being confused by listeners the test runner itself registers.
 */
export function trackListeners() {
  const proto = EventTarget.prototype;
  const origAdd = proto.addEventListener;
  const origRemove = proto.removeEventListener;
  const live = new Set<string>();

  proto.addEventListener = function (this: EventTarget, type: string, fn: unknown, opts: unknown) {
    if (fn) live.add(keyFor(this, type, fn, opts));
    return origAdd.call(this, type, fn as EventListener, opts as AddEventListenerOptions);
  } as typeof proto.addEventListener;

  proto.removeEventListener = function (
    this: EventTarget,
    type: string,
    fn: unknown,
    opts: unknown,
  ) {
    if (fn) live.delete(keyFor(this, type, fn, opts));
    return origRemove.call(this, type, fn as EventListener, opts as AddEventListenerOptions);
  } as typeof proto.removeEventListener;

  return {
    snapshot: () => new Set(live),
    /** Keys added since `before` that were never removed. */
    leakedSince: (before: Set<string>) => [...live].filter((k) => !before.has(k)),
    stop: () => {
      proto.addEventListener = origAdd;
      proto.removeEventListener = origRemove;
    },
  };
}

/* -------------------------------------------------------------------- scheduling */

export function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export async function nextFrames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await nextFrame();
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The engine's own resize debounce, plus slack. */
export const RESIZE_SETTLE_MS = 220;

/**
 * Report a value for `document.hidden` and fire the event the field listens for. A real
 * tab switch cannot be provoked from a test, and `hidden` is a getter on the prototype, so
 * it has to be redefined rather than assigned.
 */
export function setTabHidden(hidden: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  Object.defineProperty(Document.prototype, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event('visibilitychange'));
  return () => {
    if (original) Object.defineProperty(Document.prototype, 'hidden', original);
    else delete (Document.prototype as unknown as Record<string, unknown>).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  };
}

/**
 * Swap in a fake IntersectionObserver and hand back the trigger for its callback, so
 * offscreen behaviour can be driven directly instead of by scrolling and hoping. Whatever
 * `fn` creates is returned alongside.
 */
export function withFakeIntersectionObserver<T>(fn: () => T): {
  result: T;
  setIntersecting: (isIntersecting: boolean) => void;
  restore: () => void;
} {
  const original = window.IntersectionObserver;
  let callback: IntersectionObserverCallback | undefined;
  class Fake {
    constructor(cb: IntersectionObserverCallback) {
      callback = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  window.IntersectionObserver = Fake as unknown as typeof IntersectionObserver;
  let result: T;
  try {
    result = fn();
  } catch (e) {
    window.IntersectionObserver = original;
    throw e;
  }
  return {
    result,
    setIntersecting: (isIntersecting: boolean) =>
      callback?.([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver),
    restore: () => {
      window.IntersectionObserver = original;
    },
  };
}

/**
 * Force `matchMedia('(prefers-reduced-motion: reduce)')` to report a value for the duration
 * of a test. The field reads it once at construction, so this must be installed first.
 */
export function stubReducedMotion(matches: boolean): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    if (!query.includes('prefers-reduced-motion')) return original.call(window, query);
    const listeners = new Set<EventListener>();
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: (_t: string, fn: EventListener) => listeners.add(fn),
      removeEventListener: (_t: string, fn: EventListener) => listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
