import { type ParsedColor, parseColor } from './color';
import { defaults, mergeOptions, resolveDistance } from './options';
import { claimPointer, pointerOwner, releasePointer } from './pointer';
import { createRng } from './rng';
import { isWindowClip, resolveShape, windowElements, windowsPath } from './shape';
import { startTick, stopTick } from './ticker';
import type { PlexureInput, PlexureInstance, PlexureTarget } from './types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rest velocity the particle eases back toward after the cursor lets go. */
  bx: number;
  by: number;
  r: number;
  /** Per-particle alpha, driven by edgeBehaviour 'fade'. */
  a: number;
}

const RESIZE_DEBOUNCE_MS = 150;
/**
 * Consecutive frame errors tolerated before a field gives up. A field is decoration: if it
 * cannot draw, it stops and says so once, rather than throwing every frame into the host
 * page's console for as long as the tab is open.
 */
const MAX_FRAME_ERRORS = 3;
/**
 * Ceiling on spatial-hash cells. The grid cell is normally the link distance, but a very
 * small link distance would explode it: a 1 px cell over a full-page field is millions of
 * buckets rebuilt every frame, which freezes the tab. Growing the cell to fit this budget
 * is always safe, because a larger cell only widens the candidate set the distance check
 * then rejects.
 */
const MAX_GRID_CELLS = 4096;
// Historical 0.04/frame, compounded by the 2.73× the original 165 Hz hardware applied.
const INTENSITY_EASE = 0.1;

// Safety clamps: absolute px distances are capped to these fractions of the smaller
// container edge (see resolveDistance), so viewport-tuned defaults stay legible in a card.
const LINK_CLAMP = 0.4;
const CURSOR_CLAMP = 0.7;
const EDGE_CLAMP = 0.15;

/**
 * Elements marked data-plexure-ignore (or inside one) suppress the pointer reaction while
 * hovered — for controls or content the field should not respond to. closest() is a pure
 * DOM-tree walk: no layout read.
 */
function isIgnored(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return !!el?.closest?.('[data-plexure-ignore]');
}

/**
 * Handle returned when there is nothing to render into — no DOM at all (SSR), or a DOM
 * without a working 2D canvas (jsdom and friends). Every call is a silent no-op, so host
 * code and test suites can treat it exactly like a live field.
 */
export const inert: PlexureInstance = {
  setOptions() {},
  pause() {},
  resume() {},
  refresh() {},
  destroy() {},
  isRunning: false,
};

/**
 * Written as a closure rather than a class deliberately: every internal binding minifies
 * to one or two characters, where class members keep their full names in the bundle.
 */
export function createField(target: PlexureTarget, input?: PlexureInput): PlexureInstance {
  let o = mergeOptions(defaults, input);
  const mode = target === 'viewport' ? 'viewport' : target === 'page' ? 'page' : 'element';
  const host = mode === 'element' ? (target as HTMLElement) : document.body;
  let rand = createRng(o.seed);
  let shownIntensity = o.intensity;
  let hidden = document.hidden;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const particles: Particle[] = [];
  const pointer = { x: 0, y: 0, entered: false };
  /** True while the pointer sits on a [data-plexure-ignore] element. */
  let overIgnored = false;
  let width = 0;
  let height = 0;
  let rectLeft = 0;
  let rectTop = 0;
  let borderLeft = 0;
  let borderTop = 0;
  let hostPositionSet = false;

  let linkDist = 130;
  let cursorRad = 200;
  let edgeDist = 40;
  let starColor: ParsedColor;
  let linkColor: ParsedColor;
  let cursorColor: ParsedColor;

  let cols = 0;
  let rows = 0;
  let buckets: number[][] = [];

  /** Path used for the in-canvas render clip, whether or not the sim is shape-aware. */
  let clipPath: Path2D | null = null;
  /** Same path, set only when the simulation itself is confined to it. */
  let simShape: Path2D | null = null;
  let shapeBox: [number, number, number, number] | null = null;
  /** Sampled area of the shape, so `density` counts the shape's surface, not the box's. */
  let shapeArea = 0;
  /**
   * Points already proven to be inside the shape. A shape that is hard to hit by random
   * sampling falls back to these instead of retrying forever.
   */
  const anchors: [number, number][] = [];
  /** Device-pixel scale currently applied to the context. */
  let dpr = 1;
  /** Windows currently under ResizeObserver, so the mask follows them as they move. */
  let observedWindows: Element[] = [];

  let destroyed = false;
  let userPaused = false;
  /** Set after MAX_FRAME_ERRORS consecutive failures; cleared by resume(). */
  let halted = false;
  let frameErrors = 0;
  let offscreen = false;
  let ticking = false;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let ro: ResizeObserver | undefined;
  let io: IntersectionObserver | undefined;
  const cleanups: (() => void)[] = [];
  /** Registry identity for the pointer-claim stack. */
  const token = {};

  /* -------------------------------------------------------------------- canvas */

  const canvas = document.createElement('canvas');
  // Probed before anything is appended or restyled: an environment with no 2D context
  // leaves the host exactly as it was found rather than a mutated DOM and a thrown error.
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return inert;
  canvas.setAttribute('aria-hidden', 'true');
  const cs = canvas.style;
  cs.pointerEvents = 'none';
  cs.display = 'block';
  cs.position = mode === 'viewport' ? 'fixed' : 'absolute';
  cs.top = '0';
  cs.left = '0';
  cs.contain = 'strict';
  if (mode === 'element' && getComputedStyle(host).position === 'static') {
    host.style.position = 'relative';
    hostPositionSet = true;
  }
  host.appendChild(canvas);

  /* -------------------------------------------------------------------- wiring */

  function listen(
    et: EventTarget,
    type: string,
    fn: (e: Event) => void,
    opts?: AddEventListenerOptions,
  ): void {
    et.addEventListener(type, fn, opts);
    cleanups.push(() => et.removeEventListener(type, fn, opts));
  }

  /** Cache the host's viewport position (padding-box origin) for pointer coordinates. */
  function updateRect(): void {
    const r = host.getBoundingClientRect();
    rectLeft = r.left + borderLeft;
    rectTop = r.top + borderTop;
  }

  /** Created on demand so enabling pauseWhenOffscreen via setOptions also works. */
  function ensureIntersectionObserver(): void {
    if (mode !== 'element' || typeof IntersectionObserver === 'undefined') return;
    if (!o.pauseWhenOffscreen) {
      io?.disconnect();
      io = undefined;
      offscreen = false;
      return;
    }
    if (io) return;
    io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) {
        offscreen = !entry.isIntersecting;
        updateRunning();
      }
    });
    io.observe(host);
  }

  function scheduleResize(): void {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (destroyed) return;
      const { prevW, prevH } = measure();
      reflow(prevW, prevH);
      updateRunning();
      if (!ticking) renderStatic();
    }, RESIZE_DEBOUNCE_MS);
  }

  function applyStaticStyles(): void {
    cs.zIndex = String(o.zIndex);
    if (o.className !== undefined) canvas.className = o.className;
    const clip = o.clipTo;
    cs.clipPath = typeof clip === 'string' ? clip : '';
  }

  function applyColors(): void {
    const el = mode === 'element' ? host : document.documentElement;
    starColor = parseColor(o.star.color, el);
    linkColor = parseColor(o.link.color, el);
    cursorColor = parseColor(o.cursor.color, el);
  }

  /* -------------------------------------------------------------------- sizing */

  function dprFor(): number {
    // Cap so width/height in device px stay under the safe canvas dimension limit
    // (Chrome caps at 65,535, Safari lower) — matters for tall 'page' fields.
    let scale = Math.min(window.devicePixelRatio || 1, o.maxDpr);
    const maxDim = Math.max(width, height);
    if (maxDim * scale > 32000) scale = 32000 / maxDim;
    return scale;
  }

  function applyDpr(): void {
    dpr = dprFor();
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * `isPointInPath` reads its point in canvas device pixels while applying the current
   * transform to the path, so container coordinates have to be scaled up to meet it.
   * Getting this wrong looks perfect at dpr 1 and inverts on a retina display.
   */
  function inShape(shape: Path2D, x: number, y: number): boolean {
    return !!ctx && ctx.isPointInPath(shape, x * dpr, y * dpr);
  }

  /**
   * Inside the shape *and* inside the container. `fit: 'cover'` puts those in conflict on
   * purpose — it overflows the box — and a particle in the overflow is inside the shape
   * yet outside anything that can be seen. The cheap bounds test also short-circuits the
   * path test for particles that have already left the box.
   */
  function contained(shape: Path2D, x: number, y: number): boolean {
    return x >= 0 && x <= width && y >= 0 && y <= height && inShape(shape, x, y);
  }

  /**
   * The region worth sampling: the shape's own box rather than the container's, since a
   * shape covering a small slice of its container would otherwise reject almost every
   * candidate. Clamped back to the container because `fit: 'cover'` deliberately overflows
   * it, and a point in the overflow is inside the shape but outside anything visible.
   */
  function sampleBox(): [number, number, number, number] | null {
    const [bx, by, bw, bh] = shapeBox ?? [0, 0, width, height];
    const x0 = Math.max(0, bx);
    const y0 = Math.max(0, by);
    const sw = Math.min(width, bx + bw) - x0;
    const sh = Math.min(height, by + bh) - y0;
    return sw > 0 && sh > 0 ? [x0, y0, sw, sh] : null;
  }

  /** A point inside the shape, or anywhere in the box when the field is not shape-aware. */
  function pick(): [number, number] | null {
    if (!simShape) return [rand() * width, rand() * height];
    const box = sampleBox();
    if (!box) return null;
    const [x0, y0, sw, sh] = box;
    for (let i = 0; i < 24; i++) {
      const x = x0 + rand() * sw;
      const y = y0 + rand() * sh;
      if (inShape(simShape, x, y)) {
        if (anchors.length < 8) anchors.push([x, y]);
        return [x, y];
      }
    }
    return anchors.length ? anchors[(rand() * anchors.length) | 0] : null;
  }

  /**
   * Estimate the shape's area on a fixed grid, so `density` — square pixels of surface per
   * particle — means the same thing inside a shape as it does in a plain box. Measured
   * against the container instead, a star covering 40% of its box would render about two
   * and a half times denser than an unclipped field with identical settings.
   *
   * Deliberately a grid rather than random samples: it consumes no RNG, so a seeded field
   * stays reproducible across resizes.
   */
  function estimateShapeArea(): number {
    const shape = simShape;
    const box = shape && sampleBox();
    if (!shape || !box) return width * height;
    const [x0, y0, sw, sh] = box;
    let inside = 0;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (inShape(shape, x0 + ((i + 0.5) / 8) * sw, y0 + ((j + 0.5) / 8) * sh)) inside++;
      }
    }
    return (inside / 64) * sw * sh;
  }

  /**
   * Top-left of the canvas in client coordinates. An element canvas fills the host's
   * padding box, a viewport canvas sits at the viewport origin, and a page canvas sits at
   * the document origin.
   */
  function canvasOrigin(): [number, number] {
    if (mode === 'element') return [rectLeft, rectTop];
    if (mode === 'viewport') return [0, 0];
    return [-window.scrollX, -window.scrollY];
  }

  /**
   * Watch the windows themselves, not only the host. A window can change size while the
   * host does not, and the mask has to follow it.
   */
  function syncWindowObservers(next: Element[]): void {
    const same =
      next.length === observedWindows.length && next.every((el, i) => el === observedWindows[i]);
    if (same) return;
    for (const el of observedWindows) ro?.unobserve(el);
    for (const el of next) ro?.observe(el);
    observedWindows = next;
  }

  /**
   * Resolve `clipTo` against the current box. A shape that cannot be sampled at all is
   * kept as a render clip but dropped from the simulation, so a degenerate path degrades
   * to masking alone rather than producing an empty field.
   */
  function resolveClip(): void {
    anchors.length = 0;
    const clip = o.clipTo;
    if (isWindowClip(clip)) {
      // Masked, never confined: the point is one continuous field behind several
      // apertures, so a particle leaving one window reappears in the next.
      if (mode === 'element') updateRect();
      const els = windowElements(clip.windows, host);
      const [ox, oy] = canvasOrigin();
      clipPath = windowsPath(els, ox, oy);
      simShape = null;
      shapeBox = null;
      shapeArea = 0;
      syncWindowObservers(els);
      return;
    }
    syncWindowObservers([]);
    if (clip instanceof Path2D) {
      clipPath = clip;
      simShape = null;
      shapeBox = null;
      shapeArea = 0;
      return;
    }
    const resolved = resolveShape(clip, width, height);
    clipPath = resolved && resolved.path;
    simShape = clipPath;
    shapeBox = resolved && resolved.box;
    if (simShape && !pick()) simShape = null;
    shapeArea = simShape ? estimateShapeArea() : 0;
  }

  function measure(): { prevW: number; prevH: number } {
    const prevW = width;
    const prevH = height;
    if (mode === 'element') {
      // Canvas fills the padding box (absolute inset resolves against it), so size from
      // clientWidth/Height and offset the pointer origin by the border widths.
      borderLeft = host.clientLeft;
      borderTop = host.clientTop;
      width = host.clientWidth;
      height = host.clientHeight;
      updateRect();
    } else if (mode === 'viewport') {
      width = window.innerWidth;
      height = window.innerHeight;
    } else {
      // The canvas itself contributes to scrollHeight; zero it first, or a page that
      // shrinks (SPA route change) would ratchet the measurement forever.
      cs.height = '0px';
      width = document.documentElement.clientWidth;
      height = document.documentElement.scrollHeight;
    }
    applyDpr();
    cs.width = `${width}px`;
    cs.height = `${height}px`;
    resolveDistances();
    // Re-fitted here rather than once at construction, so 'contain'/'cover' track resizes.
    resolveClip();
    return { prevW, prevH };
  }

  /** Depends only on options and the cached box size — no layout reads. */
  function resolveDistances(): void {
    const minEdge = Math.min(width, height);
    // Geometric mean: equals the edge for squares, but keeps link/cursor reach useful in
    // extreme aspect ratios (a 420×36 sliver clamps to ~49px links, not 14px dust).
    const meanEdge = Math.sqrt(width * height);
    const clamp = o.clampDistances;
    linkDist = Math.max(1, resolveDistance(o.link.distance, minEdge, meanEdge, LINK_CLAMP, clamp));
    cursorRad = resolveDistance(o.cursor.radius, minEdge, meanEdge, CURSOR_CLAMP, clamp);
    edgeDist = Math.max(1, resolveDistance(o.edgeDistance, minEdge, minEdge, EDGE_CLAMP, clamp));
  }

  function targetCount(): number {
    if (!width || !height) return 0;
    const { count, minCount, maxCount, density } = o;
    // Inside a sim-aware shape, density is measured against the shape's own surface.
    const area = simShape ? shapeArea : width * height;
    const wanted =
      count !== undefined
        ? count
        : Math.max(minCount, Math.min(maxCount, Math.round(area / density)));
    // Never negative, never fractional, never NaN. reflow() pops until the array is short
    // enough, and a negative or NaN target would pop an empty array forever.
    return wanted > 0 ? Math.floor(wanted) : 0;
  }

  function spawn(x: number, y: number): Particle {
    const [minDrift, maxDrift] = o.drift;
    const [minSize, maxSize] = o.star.size;
    const speed = minDrift + rand() * (maxDrift - minDrift);
    const angle = rand() * Math.PI * 2;
    const bx = Math.cos(angle) * speed;
    const by = Math.sin(angle) * speed;
    return { x, y, vx: bx, vy: by, bx, by, r: minSize + rand() * (maxSize - minSize), a: 1 };
  }

  function seedParticles(): void {
    particles.length = 0;
    const n = targetCount();
    for (let i = 0; i < n; i++) {
      const at = pick();
      if (at) particles.push(spawn(at[0], at[1]));
    }
  }

  /**
   * Resize keeps existing particles and maps them proportionally into the new box.
   * Reseeding from scratch read as a visible jump.
   */
  function reflow(prevW: number, prevH: number): void {
    if (prevW > 0 && prevH > 0 && (prevW !== width || prevH !== height)) {
      const sx = width / prevW;
      const sy = height / prevH;
      for (const p of particles) {
        p.x *= sx;
        p.y *= sy;
      }
    }
    const want = targetCount();
    while (particles.length > want) particles.pop();
    while (particles.length < want) {
      const at = pick();
      if (!at) break;
      particles.push(spawn(at[0], at[1]));
    }
    // A new shape, or a resize that moved the old one, can leave particles stranded
    // outside it. Correct here rather than waiting for a frame, so a paused field is right
    // immediately.
    if (simShape) {
      for (const p of particles) if (!contained(simShape, p.x, p.y)) respawn(p);
    }
  }

  /* ---------------------------------------------------------------- simulation */

  function pointerActive(): boolean {
    if (!pointer.entered || overIgnored || !o.cursor.enabled) return false;
    // A shape-aware field reacts only where it actually is. The host stays a rectangle, so
    // without this the corners outside the shape still pull — dragging particles toward a
    // point they can never reach, which reads as the field twitching at nothing.
    if (simShape && !inShape(simShape, pointer.x, pointer.y)) return false;
    // Element fields react only while they own the pointer; viewport and page fields go
    // inert whenever any element field holds it.
    return mode === 'element' ? pointerOwner() === token : pointerOwner() === null;
  }

  function respawn(p: Particle): void {
    const at = pick();
    if (!at) return;
    const fresh = spawn(at[0], at[1]);
    p.x = fresh.x;
    p.y = fresh.y;
    p.vx = fresh.vx;
    p.vy = fresh.vy;
    p.bx = fresh.bx;
    p.by = fresh.by;
  }

  /**
   * Approximate how close a particle is to leaving the shape, by probing ahead along its
   * direction of travel. An exact distance to an arbitrary path is not available, and this
   * is what 'fade' actually needs: a ramp that reaches zero as the boundary arrives.
   */
  function shapeEdgeAlpha(p: Particle, shape: Path2D): number {
    const speed = Math.hypot(p.vx, p.vy);
    if (!speed) return 1;
    const ux = p.vx / speed;
    const uy = p.vy / speed;
    for (let k = 3; k >= 1; k--) {
      const d = (edgeDist * k) / 3;
      if (inShape(shape, p.x + ux * d, p.y + uy * d)) return k / 3;
    }
    return 0;
  }

  function step(dt: number): void {
    const { friction, edgeBehaviour, cursor } = o;
    const shape = simShape;
    const active = pointerActive();
    const px = pointer.x;
    const py = pointer.y;
    const cr = cursorRad;
    const cr2 = cr * cr;
    const w = width;
    const h = height;
    const margin = edgeDist;
    // Friction is a per-frame decay, so dt scales it as an exponent.
    const fr = friction === 1 ? 1 : friction ** dt;

    for (const p of particles) {
      if (active) {
        const dx = px - p.x;
        const dy = py - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1 && d2 < cr2) {
          const d = Math.sqrt(d2);
          const pull = ((cr - d) / cr) * cursor.strength * dt;
          p.vx += (dx / d) * pull;
          p.vy += (dy / d) * pull;
        }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (shape) {
        // Inside an arbitrary shape there is no opposite edge to wrap to, so 'wrap' and
        // 'respawn' both re-place the particle inside — which preserves what wrapping was
        // for, an evenly populated field rather than one bunching toward the centre.
        const inside = contained(shape, p.x, p.y);
        if (!inside) respawn(p);
        if (edgeBehaviour === 'fade') {
          p.a = inside ? shapeEdgeAlpha(p, shape) : 0;
        }
      } else if (edgeBehaviour === 'wrap') {
        // Wrap rather than respawn, so the field stays evenly populated instead of
        // bunching toward the centre.
        if (p.x < -margin) p.x = w + margin;
        else if (p.x > w + margin) p.x = -margin;
        if (p.y < -margin) p.y = h + margin;
        else if (p.y > h + margin) p.y = -margin;
      } else {
        if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) respawn(p);
        if (edgeBehaviour === 'fade') {
          const edge = Math.min(p.x, w - p.x, p.y, h - p.y);
          p.a = edge <= 0 ? 0 : Math.min(1, edge / margin);
        }
      }

      // Ease back toward rest velocity so the field settles after the cursor leaves.
      p.vx = p.vx * fr + p.bx * (1 - fr);
      p.vy = p.vy * fr + p.by * (1 - fr);
    }
  }

  /* -------------------------------------------------------------- spatial hash */

  // Rebuilt each frame. Bucketing n particles is O(n); replaces three stacked O(n²)
  // passes that ran ~43k distance checks per frame at n=170.
  function rebuildGrid(): void {
    // A non-finite distance (an unparseable '%' string, say) must not reach the maths.
    const wanted = linkDist > 0 ? linkDist : 1;
    const cell = Math.max(wanted, Math.sqrt((width * height) / MAX_GRID_CELLS));
    cols = Math.max(1, Math.ceil(width / cell));
    rows = Math.max(1, Math.ceil(height / cell));
    const total = cols * rows;
    if (buckets.length !== total) {
      buckets = Array.from({ length: total }, () => []);
    } else {
      for (const b of buckets) b.length = 0;
    }
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(p.x / cell)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(p.y / cell)));
      buckets[cy * cols + cx].push(i);
    }
  }

  /* ----------------------------------------------------------------- rendering */

  function draw(dt: number): void {
    if (!ctx) return;
    shownIntensity += (o.intensity - shownIntensity) * Math.min(1, INTENSITY_EASE * dt);
    const intensity = shownIntensity;
    const lineAlpha = o.link.opacity * linkColor.a * intensity;
    const dotAlpha = o.star.opacity * starColor.a * intensity;
    const fading = o.edgeBehaviour === 'fade';

    ctx.clearRect(0, 0, width, height);
    const pathClip = clipPath;
    if (pathClip) {
      ctx.save();
      ctx.clip(pathClip);
    }

    rebuildGrid();

    // Each cell tests itself plus four of its eight neighbours, covering every pair
    // exactly once.
    const maxD2 = linkDist * linkDist;
    const linkRgb = linkColor.rgb;
    ctx.lineWidth = o.link.width;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const cell = buckets[cy * cols + cx];
        if (cell.length === 0) continue;

        const neighbours: number[][] = [cell];
        if (cx + 1 < cols) neighbours.push(buckets[cy * cols + cx + 1]);
        if (cy + 1 < rows) {
          if (cx > 0) neighbours.push(buckets[(cy + 1) * cols + cx - 1]);
          neighbours.push(buckets[(cy + 1) * cols + cx]);
          if (cx + 1 < cols) neighbours.push(buckets[(cy + 1) * cols + cx + 1]);
        }

        for (let n = 0; n < neighbours.length; n++) {
          const other = neighbours[n];
          for (let a = 0; a < cell.length; a++) {
            // Within the home cell only walk forward, so pairs are not doubled.
            const startB = n === 0 ? a + 1 : 0;
            for (let b = startB; b < other.length; b++) {
              const p = particles[cell[a]];
              const q = particles[other[b]];
              const dx = p.x - q.x;
              const dy = p.y - q.y;
              const d2 = dx * dx + dy * dy;
              if (d2 >= maxD2) continue;
              let alpha = (1 - Math.sqrt(d2) / linkDist) * lineAlpha;
              if (fading) alpha *= Math.min(p.a, q.a);
              ctx.strokeStyle = `rgba(${linkRgb}, ${alpha})`;
              ctx.beginPath();
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(q.x, q.y);
              ctx.stroke();
            }
          }
        }
      }
    }

    // Nearest-k to the pointer, by insertion into a fixed small buffer. Cheaper than
    // sorting the whole field every frame.
    if (pointerActive()) {
      const maxLinks = o.cursor.maxLinks;
      const px = pointer.x;
      const py = pointer.y;
      const best: { i: number; d: number }[] = [];
      const byDist = (m: { d: number }, n: { d: number }) => m.d - n.d;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const d = Math.hypot(px - p.x, py - p.y);
        if (d > linkDist) continue;
        if (best.length < maxLinks) {
          best.push({ i, d });
          best.sort(byDist);
        } else if (d < best[best.length - 1].d) {
          best[best.length - 1] = { i, d };
          best.sort(byDist);
        }
      }
      const cursorAlpha = o.cursor.opacity * cursorColor.a * intensity;
      const cursorRgb = cursorColor.rgb;
      ctx.lineWidth = o.cursor.width;
      for (const { i, d } of best) {
        const p = particles[i];
        let alpha = (1 - d / linkDist) * cursorAlpha;
        if (fading) alpha *= p.a;
        ctx.strokeStyle = `rgba(${cursorRgb}, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    }

    const starRgb = starColor.rgb;
    const softness = o.star.softness;
    if (softness > 0) {
      for (const p of particles) {
        const alpha = fading ? dotAlpha * p.a : dotAlpha;
        const radius = p.r * (1 + softness * 1.5);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        g.addColorStop(0, `rgba(${starRgb}, ${alpha})`);
        g.addColorStop(Math.max(0.01, 1 - softness), `rgba(${starRgb}, ${alpha})`);
        g.addColorStop(1, `rgba(${starRgb}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (fading) {
      for (const p of particles) {
        ctx.fillStyle = `rgba(${starRgb}, ${dotAlpha * p.a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = `rgba(${starRgb}, ${dotAlpha})`;
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (pathClip) ctx.restore();
  }

  /* ---------------------------------------------------------------------- loop */

  /**
   * A thrown frame must never take the host page with it. Transient failures (a lost
   * context mid-resize, say) are swallowed and retried; a field that fails
   * MAX_FRAME_ERRORS frames in a row stops for good and warns exactly once.
   */
  const tick = (dt: number): void => {
    try {
      step(dt);
      draw(dt);
      frameErrors = 0;
    } catch (error) {
      if (++frameErrors < MAX_FRAME_ERRORS) return;
      halted = true;
      updateRunning();
      console.warn('plexure: stopped after repeated render errors', error);
    }
  };

  function reducedNow(): boolean {
    return o.respectReducedMotion && reduceMotion.matches;
  }

  /** One still frame under reduced motion ('static'), or a cleared canvas ('none'). */
  function renderStatic(): void {
    if (destroyed) return;
    if (reducedNow() && o.reducedMotion === 'none') {
      ctx?.clearRect(0, 0, width, height);
      return;
    }
    const eased = shownIntensity;
    shownIntensity = o.intensity;
    // Guarded like tick: a still frame is drawn from pause(), resize and setOptions, all of
    // which are called straight from host code that must not receive our exceptions.
    try {
      draw(1);
    } catch {
      halted = true;
    }
    shownIntensity = reducedNow() ? o.intensity : eased;
  }

  function updateRunning(): void {
    const shouldRun =
      !destroyed &&
      !halted &&
      !userPaused &&
      width > 0 &&
      height > 0 &&
      !(o.pauseWhenHidden && hidden) &&
      !(o.pauseWhenOffscreen && offscreen) &&
      !reducedNow();
    if (shouldRun === ticking) return;
    ticking = shouldRun;
    if (shouldRun) startTick(tick);
    else {
      stopTick(tick);
      renderStatic();
    }
  }

  /* -------------------------------------------------------- events & observers */

  applyStaticStyles();
  applyColors();

  listen(document, 'visibilitychange', () => {
    hidden = document.hidden;
    if (hidden) {
      pointer.entered = false;
      if (mode === 'element') releasePointer(token);
    }
    updateRunning();
  });
  listen(window, 'blur', () => {
    pointer.entered = false;
    if (mode === 'element') releasePointer(token);
  });
  const onMotionChange = () => updateRunning();
  reduceMotion.addEventListener('change', onMotionChange);
  cleanups.push(() => reduceMotion.removeEventListener('change', onMotionChange));

  if (mode === 'element') {
    listen(host, 'pointerenter', (e) => {
      // One rect read per entry keeps coordinates honest after layout shifts above the
      // host (image loads, collapsing banners) that involve neither scroll nor resize.
      updateRect();
      pointer.entered = true;
      overIgnored = isIgnored(e.target);
      pointer.x = (e as PointerEvent).clientX - rectLeft;
      pointer.y = (e as PointerEvent).clientY - rectTop;
      claimPointer(token, host);
    });
    listen(
      host,
      'pointermove',
      (e) => {
        // A move over the host proves the pointer is inside it, so this also restores
        // the entered state and the claim after a window blur or tab switch, where
        // pointerenter never refires.
        if (!pointer.entered) {
          pointer.entered = true;
          claimPointer(token, host);
        }
        overIgnored = isIgnored(e.target);
        pointer.x = (e as PointerEvent).clientX - rectLeft;
        pointer.y = (e as PointerEvent).clientY - rectTop;
      },
      { passive: true },
    );
    listen(host, 'pointerleave', () => {
      pointer.entered = false;
      overIgnored = false;
      releasePointer(token);
    });
    // The rect is cached here, on entry, and on resize — never read on pointermove: one
    // layout read per scroll frame instead of one per pointer event. Capture catches
    // nested scrollers.
    listen(window, 'scroll', () => updateRect(), { passive: true, capture: true });
    ro = new ResizeObserver(() => scheduleResize());
    ro.observe(host);
    ensureIntersectionObserver();
  } else {
    listen(
      window,
      'pointermove',
      (e) => {
        const p = e as PointerEvent;
        pointer.entered = true;
        overIgnored = isIgnored(e.target);
        if (mode === 'viewport') {
          pointer.x = p.clientX;
          pointer.y = p.clientY;
        } else {
          // The page canvas is document-anchored; pageX/Y need no rect and no layout read.
          pointer.x = p.pageX;
          pointer.y = p.pageY;
        }
      },
      { passive: true },
    );
    listen(window, 'pointerout', (e) => {
      if ((e as PointerEvent).relatedTarget === null) pointer.entered = false;
    });
    listen(window, 'resize', () => scheduleResize(), { passive: true });
    if (mode === 'page') {
      // Fires when content changes the document height.
      ro = new ResizeObserver(() => scheduleResize());
      ro.observe(document.documentElement);
    }
  }

  /* ------------------------------------------------------------------------ go */

  measure();
  seedParticles();
  updateRunning();
  if (!ticking) renderStatic();

  /* -------------------------------------------------------------------- handle */

  return {
    /** Applies live with zero layout reads, so it is safe to drive from scroll or render. */
    setOptions(patch: PlexureInput): void {
      if (destroyed) return;
      const prevSeed = o.seed;
      const prevDpr = o.maxDpr;
      o = mergeOptions(o, patch);
      if (o.seed !== prevSeed) rand = createRng(o.seed);
      applyStaticStyles();
      applyColors();
      resolveDistances();
      ensureIntersectionObserver();
      if (o.maxDpr !== prevDpr) applyDpr();
      // After applyDpr, because containment tests are scaled by the current dpr.
      resolveClip();
      reflow(width, height);
      updateRunning();
      if (!ticking) renderStatic();
    },
    pause(): void {
      userPaused = true;
      updateRunning();
    },
    resume(): void {
      userPaused = false;
      // Also the way back from a halt, so a caller who fixed the cause can restart the
      // field without rebuilding it.
      halted = false;
      frameErrors = 0;
      updateRunning();
    },
    refresh(): void {
      if (destroyed) return;
      const { prevW, prevH } = measure();
      reflow(prevW, prevH);
      updateRunning();
      if (!ticking) renderStatic();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopTick(tick);
      ticking = false;
      clearTimeout(resizeTimer);
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      ro?.disconnect();
      io?.disconnect();
      observedWindows = [];
      releasePointer(token);
      canvas.remove();
      if (hostPositionSet) host.style.position = '';
      particles.length = 0;
    },
    get isRunning(): boolean {
      return ticking;
    },
  };
}
