/**
 * A distance option. A number is CSS pixels; a string like `'35%'` is a fraction of the
 * smaller edge of the container the field is mounted in.
 */
export type Distance = number | `${number}%`;

export type EdgeBehaviour = 'wrap' | 'fade' | 'respawn';

export interface StarOptions {
  /** Radius range, px. Each particle picks a random radius inside it. */
  size: [number, number];
  /** Peak opacity of particle fills, 0–1. */
  opacity: number;
  /** 0 is a hard disc, 1 a fully soft radial falloff. */
  softness: number;
  /** Any CSS colour, including `var(--custom-props)`. */
  color: string;
}

export interface LinkOptions {
  /** Longest particle-to-particle link drawn. */
  distance: Distance;
  /** Link line width, px. */
  width: number;
  /** Peak link opacity, scaled down with distance. */
  opacity: number;
  /** Any CSS colour. */
  color: string;
}

export interface CursorOptions {
  /** Master switch for pointer interaction. */
  enabled: boolean;
  /** Reach of the pointer's pull. */
  radius: Distance;
  /** How hard the pointer pulls, in velocity gained per frame at zero distance. */
  strength: number;
  /** How many particles may link back to the pointer at once. */
  maxLinks: number;
  /** Pointer link line width, px. */
  width: number;
  /** Peak pointer link opacity, scaled down with distance. */
  opacity: number;
  /** Any CSS colour. */
  color: string;
}

/** How a shape's own coordinate space is mapped into the container. */
export type ClipFit = 'contain' | 'cover' | 'none';

/**
 * A shape the field is confined to — not just drawn through. Particles are seeded inside
 * it and re-placed inside when they leave, so the simulation itself is shape-aware.
 */
export interface ShapeClip {
  /** SVG path data (`'M 0 0 L 100 0 …'`), or a `Path2D` in its own coordinate space. */
  path: string | Path2D;
  /**
   * Defaults to `'contain'`. Needs the shape's bounds, which are measured automatically
   * from SVG path data. A `Path2D` carries no bounds, so supply `viewBox` for it —
   * without one, the path is used as-is in container pixels (`'none'`).
   */
  fit?: ClipFit;
  /** `[x, y, width, height]` of the shape's coordinate space. */
  viewBox?: [number, number, number, number];
}

export interface PlexureOptions {
  /** Square pixels of surface per particle. Lower is denser. */
  density: number;
  /** Absolute particle count. Overrides `density` and the count clamps when set. */
  count: number | undefined;
  minCount: number;
  maxCount: number;
  /** Base drift speed range, px per frame. */
  drift: [number, number];
  /** How fast a disturbed particle settles back toward its rest velocity, per frame. */
  friction: number;
  star: StarOptions;
  link: LinkOptions;
  cursor: CursorOptions;
  /** What happens at the container boundary. */
  edgeBehaviour: EdgeBehaviour;
  /** Wrap margin beyond the edge, or where fading begins for `'fade'`. */
  edgeDistance: Distance;
  /**
   * Confine the field to a shape. A string is applied as a CSS `clip-path` on the canvas
   * (`polygon(...)`, `circle(...)`, `url(#svgClip)`, ...). A `Path2D` is clipped in-canvas,
   * in CSS pixel coordinates of the container. Both of those clip the *render* only — the
   * simulation still runs in the full bounding box.
   *
   * A {@link ShapeClip} object clips the *simulation* too: particles are seeded inside the
   * shape and re-placed inside when they leave, so the field genuinely lives in the shape
   * rather than being masked by it. `null` clears a previous clip.
   */
  clipTo: string | Path2D | ShapeClip | null;
  /** Master presence multiplier, 0–1. Changes are eased, so it can be driven from scroll. */
  intensity: number;
  /**
   * When true (default), absolute pixel distances are capped so small containers stay
   * legible: link and cursor distances against the geometric mean of the container edges
   * (which keeps slivers connected along their long axis), edge margins against the
   * smaller edge. `'%'` values are never clamped.
   */
  clampDistances: boolean;
  respectReducedMotion: boolean;
  /** Under reduced motion: `'static'` renders one still frame, `'none'` renders nothing. */
  reducedMotion: 'static' | 'none';
  pauseWhenHidden: boolean;
  pauseWhenOffscreen: boolean;
  /** Cap on devicePixelRatio scaling. */
  maxDpr: number;
  /** Seed for deterministic layout. Omit for `Math.random`. */
  seed: number | undefined;
  zIndex: number;
  /** Class applied to the canvas element. */
  className: string | undefined;
}

/** Partial options accepted by `createPlexure` and `setOptions`. */
export interface PlexureInput
  extends Partial<
    Omit<PlexureOptions, 'star' | 'link' | 'cursor' | 'count' | 'seed' | 'className'>
  > {
  star?: Partial<StarOptions>;
  link?: Partial<LinkOptions>;
  cursor?: Partial<CursorOptions>;
  count?: number;
  seed?: number;
  className?: string;
}

export type PlexureTarget = HTMLElement | 'viewport' | 'page';

export interface PlexureInstance {
  /** Merge a partial options object and apply it live, without restarting the field. */
  setOptions(options: PlexureInput): void;
  pause(): void;
  resume(): void;
  /** Force a re-measure, e.g. after moving the container yourself. */
  refresh(): void;
  /** Remove the canvas and drop every listener and observer. */
  destroy(): void;
  readonly isRunning: boolean;
}
