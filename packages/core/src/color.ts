export interface ParsedColor {
  /** "r, g, b" triplet, ready for template interpolation into rgba(). */
  rgb: string;
  /** Alpha carried by the colour itself, multiplied into the option's opacity. */
  a: number;
}

const FALLBACK: ParsedColor = { rgb: '255, 255, 255', a: 1 };
const CACHE_MAX = 256;

let parserCtx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, ParsedColor>();

const RGB_RE = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/;

/**
 * Accepts any CSS colour, including nested `var(--a, var(--b, #fff))` resolved against
 * `host`. Normalised once through a canvas fillStyle round-trip and cached; a pixel
 * read-back covers formats the round-trip does not normalise to hex/rgba (e.g.
 * `color(display-p3 ...)`). Invalid colours fall back to white rather than silently
 * rendering black.
 */
export function parseColor(input: string, host: Element | null): ParsedColor {
  let value = input.trim();
  for (let depth = 0; depth < 4 && value.startsWith('var('); depth++) {
    const inner = value.slice(4, -1);
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? '' : inner.slice(comma + 1).trim();
    const el = host ?? document.documentElement;
    value = getComputedStyle(el).getPropertyValue(name).trim() || fallback || '#fff';
  }

  const hit = cache.get(value);
  if (hit) return hit;

  if (!parserCtx) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    parserCtx = c.getContext('2d', { willReadFrequently: true });
  }
  const ctx = parserCtx;
  if (!ctx) return FALLBACK;

  // Primed twice with different colours: an invalid value leaves the two primes intact
  // and reveals itself by disagreeing, instead of masquerading as black.
  ctx.fillStyle = '#000';
  ctx.fillStyle = value;
  const norm = ctx.fillStyle;
  ctx.fillStyle = '#fff';
  ctx.fillStyle = value;
  const check = ctx.fillStyle;

  let out: ParsedColor;
  const m = RGB_RE.exec(norm);
  if (norm !== check) {
    out = FALLBACK;
  } else if (norm[0] === '#') {
    const n = Number.parseInt(norm.slice(1), 16);
    out = { rgb: `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`, a: 1 };
  } else if (m) {
    out = {
      rgb: `${m[1]}, ${m[2]}, ${m[3]}`,
      a: m[4] === undefined ? 1 : Number.parseFloat(m[4]),
    };
  } else {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    out = { rgb: `${d[0]}, ${d[1]}, ${d[2]}`, a: d[3] / 255 };
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(value, out);
  return out;
}
