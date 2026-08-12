import { describe, expect, it } from 'vitest';
import { defaults, mergeOptions, resolveDistance } from '../src/options';
import type { PlexureOptions } from '../src/types';

describe('mergeOptions', () => {
  it('returns defaults unchanged when given no input', () => {
    expect(mergeOptions(defaults, undefined)).toEqual(defaults);
  });

  it('does not mutate the base object', () => {
    const snapshot = structuredClone(defaults);
    mergeOptions(defaults, { density: 1, star: { opacity: 0.1 } });
    expect(defaults).toEqual(snapshot);
  });

  it('returns a fresh nested object rather than aliasing the base', () => {
    const merged = mergeOptions(defaults, { star: { opacity: 0.1 } });
    expect(merged.star).not.toBe(defaults.star);
    expect(merged.link).not.toBe(defaults.link);
    expect(merged.cursor).not.toBe(defaults.cursor);
  });

  it('applies top-level overrides', () => {
    const merged = mergeOptions(defaults, { density: 5000, intensity: 0.5 });
    expect(merged.density).toBe(5000);
    expect(merged.intensity).toBe(0.5);
    expect(merged.friction).toBe(defaults.friction);
  });

  it('merges nested groups partially, keeping untouched keys', () => {
    const merged = mergeOptions(defaults, { star: { opacity: 0.9 } });
    expect(merged.star.opacity).toBe(0.9);
    expect(merged.star.color).toBe(defaults.star.color);
    expect(merged.star.size).toEqual(defaults.star.size);
  });

  // Spread-with-undefined would clobber the base; the merge must skip undefined instead.
  it('ignores explicitly-undefined keys instead of clobbering', () => {
    const merged = mergeOptions(defaults, {
      density: undefined,
      star: { color: undefined },
    } as never);
    expect(merged.density).toBe(defaults.density);
    expect(merged.star.color).toBe(defaults.star.color);
  });

  it('accepts falsy values that are not undefined', () => {
    const merged = mergeOptions(defaults, {
      intensity: 0,
      zIndex: 0,
      clampDistances: false,
      cursor: { enabled: false },
    });
    expect(merged.intensity).toBe(0);
    expect(merged.clampDistances).toBe(false);
    expect(merged.cursor.enabled).toBe(false);
  });

  it('skips prototype-shaped keys so merging untrusted JSON cannot pollute', () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":true},"density":1}');
    const merged = mergeOptions(defaults, hostile);
    expect(merged.density).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });

  it('skips constructor and prototype keys in nested groups too', () => {
    const merged = mergeOptions(defaults, {
      star: JSON.parse('{"constructor":"boom","prototype":"boom","opacity":0.2}'),
    });
    expect(merged.star.opacity).toBe(0.2);
    expect(merged.star.constructor).toBe(Object);
    expect((merged.star as unknown as Record<string, unknown>).prototype).toBeUndefined();
  });

  // setOptions merges the *current* options as the base, so merging must compose.
  it('composes when the previous result is used as the next base', () => {
    const first = mergeOptions(defaults, { star: { opacity: 0.5 } });
    const second = mergeOptions(first, { star: { color: 'red' } });
    expect(second.star.opacity).toBe(0.5);
    expect(second.star.color).toBe('red');
  });
});

describe('resolveDistance', () => {
  const clampEdge = 300;

  it('resolves a percentage against the given edge, not the clamp basis', () => {
    expect(resolveDistance('35%', 200, clampEdge, 0.4, true)).toBeCloseTo(70);
  });

  it('never clamps percentages, even above the clamp ceiling', () => {
    // 90% of 200 = 180, well above clampEdge * 0.4 = 120.
    expect(resolveDistance('90%', 200, clampEdge, 0.4, true)).toBeCloseTo(180);
  });

  it('passes an absolute value through when it is under the ceiling', () => {
    expect(resolveDistance(50, 200, clampEdge, 0.4, true)).toBe(50);
  });

  it('clamps an absolute value to clampEdge * clampFrac', () => {
    expect(resolveDistance(999, 200, clampEdge, 0.4, true)).toBeCloseTo(120);
  });

  it('leaves absolute values untouched when clamping is off', () => {
    expect(resolveDistance(999, 200, clampEdge, 0.4, false)).toBe(999);
  });

  it('handles fractional percentage strings', () => {
    expect(resolveDistance('12.5%', 400, clampEdge, 0.4, true)).toBeCloseTo(50);
  });
});

describe('defaults', () => {
  // These encode the energy Jordan signed off on (165 Hz baseline, k = 2.75).
  // A change here is a change to the look of every field that does not override them.
  it('carry the tuned time-normalised physics constants', () => {
    expect(defaults.drift).toEqual([0.49, 1.31]);
    expect(defaults.cursor.strength).toBeCloseTo(0.41);
    expect(defaults.friction).toBeCloseTo(0.96);
  });

  it('leave count and seed unset so density and Math.random drive the field', () => {
    expect(defaults.count).toBeUndefined();
    expect(defaults.seed).toBeUndefined();
  });

  it('describe a self-contained, non-intrusive field', () => {
    const o: PlexureOptions = defaults;
    expect(o.respectReducedMotion).toBe(true);
    expect(o.pauseWhenHidden).toBe(true);
    expect(o.pauseWhenOffscreen).toBe(true);
    expect(o.clipTo).toBeNull();
  });
});
