import { type ParsedColor, parseColor } from './color';
import { defaults, mergeOptions, resolveDistance } from './options';
import { claimPointer, pointerOwner, releasePointer } from './pointer';
import { createRng } from './rng';
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

  let destroyed = false;
  let userPaused = false;
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
    let dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr);
    const maxDim = Math.max(width, height);
    if (maxDim * dpr > 32000) dpr = 32000 / maxDim;
    return dpr;
  }

  function applyDpr(): void {
    const dpr = dprFor();
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    if (count !== undefined) return count;
    return Math.max(minCount, Math.min(maxCount, Math.round((width * height) / density)));
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
      particles.push(spawn(rand() * width, rand() * height));
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
      particles.push(spawn(rand() * width, rand() * height));
    }
  }

  /* ---------------------------------------------------------------- simulation */

  function pointerActive(): boolean {
    if (!pointer.entered || overIgnored || !o.cursor.enabled) return false;
    // Element fields react only while they own the pointer; viewport and page fields go
    // inert whenever any element field holds it.
    return mode === 'element' ? pointerOwner() === token : pointerOwner() === null;
  }

  function respawn(p: Particle): void {
    const fresh = spawn(rand() * width, rand() * height);
    p.x = fresh.x;
    p.y = fresh.y;
    p.vx = fresh.vx;
    p.vy = fresh.vy;
    p.bx = fresh.bx;
    p.by = fresh.by;
  }

  function step(dt: number): void {
    const { friction, edgeBehaviour, cursor } = o;
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

      if (edgeBehaviour === 'wrap') {
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
    const cell = linkDist;
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
    const pathClip = o.clipTo instanceof Path2D ? o.clipTo : null;
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

  const tick = (dt: number): void => {
    step(dt);
    draw(dt);
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
    draw(1);
    shownIntensity = reducedNow() ? o.intensity : eased;
  }

  function updateRunning(): void {
    const shouldRun =
      !destroyed &&
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
