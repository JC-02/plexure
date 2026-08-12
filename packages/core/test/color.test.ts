import { afterEach, describe, expect, it } from 'vitest';
import { parseColor } from '../src/color';

const WHITE = '255, 255, 255';

const hosts: HTMLElement[] = [];
function hostWith(props: Record<string, string>): HTMLElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v);
  document.body.appendChild(el);
  hosts.push(el);
  return el;
}

afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

describe('parseColor — literal formats', () => {
  it('parses long hex', () => {
    expect(parseColor('#EBE9E4', null)).toEqual({ rgb: '235, 233, 228', a: 1 });
  });

  it('parses short hex', () => {
    expect(parseColor('#f00', null)).toEqual({ rgb: '255, 0, 0', a: 1 });
  });

  it('parses hex with a leading zero byte', () => {
    // Guards the `parseInt(hex)` path against dropping high-order zeros.
    expect(parseColor('#00ff80', null)).toEqual({ rgb: '0, 255, 128', a: 1 });
  });

  it('parses black without mistaking it for a parse failure', () => {
    expect(parseColor('#000000', null)).toEqual({ rgb: '0, 0, 0', a: 1 });
  });

  it('parses rgb()', () => {
    expect(parseColor('rgb(1, 2, 3)', null)).toEqual({ rgb: '1, 2, 3', a: 1 });
  });

  it('parses rgba() and carries the alpha', () => {
    const c = parseColor('rgba(10, 20, 30, 0.5)', null);
    expect(c.rgb).toBe('10, 20, 30');
    expect(c.a).toBeCloseTo(0.5);
  });

  it('parses hsl()', () => {
    expect(parseColor('hsl(0, 100%, 50%)', null).rgb).toBe('255, 0, 0');
  });

  it('parses named colours', () => {
    expect(parseColor('red', null).rgb).toBe('255, 0, 0');
  });

  it('parses transparent as zero alpha', () => {
    expect(parseColor('transparent', null).a).toBe(0);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseColor('  #f00  ', null).rgb).toBe('255, 0, 0');
  });

  // Wide-gamut and other modern syntaxes do not normalise to hex or rgba(), so they take
  // the pixel read-back branch.
  it('parses colours that need the pixel read-back path', () => {
    const c = parseColor('oklch(0.7 0.15 200)', null);
    expect(c.rgb).toMatch(/^\d+, \d+, \d+$/);
    expect(c.rgb).not.toBe('0, 0, 0');
    expect(c.a).toBeCloseTo(1, 1);
  });
});

describe('parseColor — invalid input', () => {
  // Falling back to white rather than black is deliberate: a mistyped colour should be
  // visible on the dark backgrounds this library is usually mounted on, not invisible.
  it.each(['not-a-colour', '', '#12345', 'rgb(300)', 'var(', '#'])(
    'falls back to white for %o',
    (input) => {
      expect(parseColor(input, null)).toEqual({ rgb: WHITE, a: 1 });
    },
  );

  it('does not mistake a genuinely black colour for invalid input', () => {
    expect(parseColor('black', null).rgb).toBe('0, 0, 0');
  });
});

describe('parseColor — custom properties', () => {
  it('resolves var() against the host element', () => {
    const host = hostWith({ '--brand': '#ff0000' });
    expect(parseColor('var(--brand)', host).rgb).toBe('255, 0, 0');
  });

  it('resolves var() against the document when no host is given', () => {
    document.documentElement.style.setProperty('--doc-brand', '#00ff00');
    try {
      expect(parseColor('var(--doc-brand)', null).rgb).toBe('0, 255, 0');
    } finally {
      document.documentElement.style.removeProperty('--doc-brand');
    }
  });

  it('uses the fallback when the property is undefined', () => {
    const host = hostWith({});
    expect(parseColor('var(--missing, #0000ff)', host).rgb).toBe('0, 0, 255');
  });

  it('resolves nested var() fallbacks', () => {
    const host = hostWith({ '--inner': '#123456' });
    expect(parseColor('var(--missing, var(--inner))', host).rgb).toBe('18, 52, 86');
  });

  it('inherits a custom property from an ancestor', () => {
    const parent = hostWith({ '--inherited': '#abcdef' });
    const child = document.createElement('div');
    parent.appendChild(child);
    expect(parseColor('var(--inherited)', child).rgb).toBe('171, 205, 239');
  });

  it('falls back to white when a var chain resolves to nothing usable', () => {
    const host = hostWith({});
    expect(parseColor('var(--missing)', host).rgb).toBe(WHITE);
  });

  it('gives up rather than looping on deeply self-referential vars', () => {
    const host = hostWith({ '--loop': 'var(--loop)' });
    expect(() => parseColor('var(--loop)', host)).not.toThrow();
  });

  // The var() indirection is resolved before the cache is consulted, so a theme swap is
  // picked up rather than serving the previous theme's colour.
  it('reflects a changed custom property instead of serving a stale cache hit', () => {
    const host = hostWith({ '--themed': '#ff0000' });
    expect(parseColor('var(--themed)', host).rgb).toBe('255, 0, 0');
    host.style.setProperty('--themed', '#0000ff');
    expect(parseColor('var(--themed)', host).rgb).toBe('0, 0, 255');
  });

  it('resolves the same var name differently per host element', () => {
    const a = hostWith({ '--scoped': '#ff0000' });
    const b = hostWith({ '--scoped': '#00ff00' });
    expect(parseColor('var(--scoped)', a).rgb).toBe('255, 0, 0');
    expect(parseColor('var(--scoped)', b).rgb).toBe('0, 255, 0');
  });
});

describe('parseColor — caching', () => {
  it('returns a cached result for a repeated literal', () => {
    const a = parseColor('#0a0b0c', null);
    const b = parseColor('#0a0b0c', null);
    expect(b).toBe(a);
  });

  it('stays correct after the cache is cleared by overflow', () => {
    // CACHE_MAX is 256; push well past it, then re-check an early entry.
    const first = parseColor('rgb(1, 1, 1)', null);
    for (let i = 0; i < 300; i++) parseColor(`rgb(${i}, ${i}, ${i})`, null);
    expect(parseColor('rgb(1, 1, 1)', null)).toEqual(first);
  });
});
