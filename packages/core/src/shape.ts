import type { PlexureOptions, ShapeClip, WindowClip } from './types';

/** A clip resolved into container pixel space, ready for both clipping and containment. */
export interface ResolvedShape {
  path: Path2D;
  /** Bounding box in container pixels, or null when the shape's extent is unknown. */
  box: [number, number, number, number] | null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Measuring costs a forced layout, and `measure()` runs on every resize and every
 * `refresh()`. Path data does not change between those calls, so the result is cached —
 * without this a single refresh costs ~6 ms, and a window resize multiplies that by every
 * field on the page.
 */
const boundsCache = new Map<string, [number, number, number, number] | null>();
const CACHE_MAX = 64;

function isShapeClip(clip: PlexureOptions['clipTo']): clip is ShapeClip {
  return !!clip && typeof clip === 'object' && !(clip instanceof Path2D) && 'path' in clip;
}

export function isWindowClip(clip: PlexureOptions['clipTo']): clip is WindowClip {
  return !!clip && typeof clip === 'object' && !(clip instanceof Path2D) && 'windows' in clip;
}

/** Resolve the window list, tolerating a selector that matches nothing or does not parse. */
export function windowElements(spec: WindowClip['windows'], host: Element): Element[] {
  if (typeof spec !== 'string') return spec ? spec.filter(Boolean) : [];
  try {
    return [...host.querySelectorAll(spec)];
  } catch {
    return [];
  }
}

/**
 * One CSS corner radius in pixels. Percentages resolve against the box, and an elliptical
 * radius (`10px / 20px`) uses its horizontal component, which keeps the mask a close match
 * without parsing the full two-axis grammar.
 */
function corner(value: string, extent: number): number {
  const first = value.split(' ')[0];
  const n = Number.parseFloat(first);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return first.endsWith('%') ? (n / 100) * extent : n;
}

/**
 * The union of the window elements as one path, in canvas coordinates. Overlapping windows
 * merge under the nonzero fill rule, so they need no deduplication.
 *
 * Always returns a path, empty when nothing resolved. An empty clip paints nothing, which
 * is what "visible only through these windows" means when there are none, and it avoids a
 * flash of unmasked field when the windows mount after the field does.
 */
export function windowsPath(elements: Element[], originX: number, originY: number): Path2D {
  const path = new Path2D();
  const rounded = typeof path.roundRect === 'function';
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const x = r.left - originX;
    const y = r.top - originY;
    if (!rounded) {
      path.rect(x, y, r.width, r.height);
      continue;
    }
    const style = getComputedStyle(el);
    path.roundRect(x, y, r.width, r.height, [
      corner(style.borderTopLeftRadius, r.width),
      corner(style.borderTopRightRadius, r.width),
      corner(style.borderBottomRightRadius, r.width),
      corner(style.borderBottomLeftRadius, r.width),
    ]);
  }
  return path;
}

/**
 * `Path2D` exposes no bounds, so measure through a throwaway SVG element instead.
 * `getBBox()` silently returns zeros while the element is detached, so it has to be in the
 * document — a hidden, zero-size `<svg>` measures without contributing to layout.
 */
function measurePath(d: string): [number, number, number, number] | null {
  const hit = boundsCache.get(d);
  if (hit !== undefined) return hit;
  const measured = measureUncached(d);
  if (boundsCache.size >= CACHE_MAX) boundsCache.clear();
  boundsCache.set(d, measured);
  return measured;
}

function measureUncached(d: string): [number, number, number, number] | null {
  let svg: SVGSVGElement | undefined;
  try {
    svg = document.createElementNS(SVG_NS, 'svg');
    // Absolutely positioned at zero size: measurable, but contributes nothing to layout.
    svg.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
    const el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('d', d);
    svg.appendChild(el);
    document.body.appendChild(svg);
    const b = el.getBBox();
    return b.width > 0 && b.height > 0 ? [b.x, b.y, b.width, b.height] : null;
  } catch {
    // Measuring is a convenience for `fit`; never let it take the host page down with it.
    return null;
  } finally {
    svg?.remove();
  }
}

/**
 * Bake the fit transform into a single pre-fitted path, so every per-frame containment
 * test is already in container coordinates and costs nothing extra.
 *
 * Returns null when the clip is not a sim-aware shape, or when the container has no size.
 */
export function resolveShape(
  clip: PlexureOptions['clipTo'],
  width: number,
  height: number,
): ResolvedShape | null {
  if (!isShapeClip(clip) || width <= 0 || height <= 0) return null;

  const source = clip.path;
  let path: Path2D;
  try {
    path = typeof source === 'string' ? new Path2D(source) : source;
  } catch {
    return null;
  }

  const fit = clip.fit ?? 'contain';
  const box = clip.viewBox ?? (typeof source === 'string' ? measurePath(source) : null);
  // Without bounds there is nothing to fit against, so the path is taken to already be in
  // container pixels.
  if (fit === 'none' || !box || !(box[2] > 0) || !(box[3] > 0)) {
    return { path, box: box ?? null };
  }

  const [bx, by, bw, bh] = box;
  const scale =
    fit === 'cover' ? Math.max(width / bw, height / bh) : Math.min(width / bw, height / bh);
  const tx = (width - bw * scale) / 2 - bx * scale;
  const ty = (height - bh * scale) / 2 - by * scale;

  const fitted = new Path2D();
  fitted.addPath(path, new DOMMatrix([scale, 0, 0, scale, tx, ty]));
  return {
    path: fitted,
    box: [bx * scale + tx, by * scale + ty, bw * scale, bh * scale],
  };
}
