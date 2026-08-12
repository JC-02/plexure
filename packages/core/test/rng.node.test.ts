import { describe, expect, it } from 'vitest';
import { createRng } from '../src/rng';

describe('createRng', () => {
  it('falls back to Math.random when no seed is given', () => {
    expect(createRng(undefined)).toBe(Math.random);
  });

  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 32 }, () => a());
    const seqB = Array.from({ length: 32 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces a different sequence for a different seed', () => {
    const a = Array.from({ length: 16 }, createRng(1));
    const b = Array.from({ length: 16 }, createRng(2));
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const rand = createRng(7);
    for (let i = 0; i < 5000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('does not immediately repeat itself', () => {
    const rand = createRng(99);
    const seen = new Set(Array.from({ length: 1000 }, () => rand()));
    expect(seen.size).toBe(1000);
  });

  it('spreads roughly evenly across the unit interval', () => {
    const rand = createRng(2024);
    const buckets = new Array(10).fill(0);
    const n = 10000;
    for (let i = 0; i < n; i++) buckets[Math.floor(rand() * 10)]++;
    // A uniform generator puts ~1000 in each bucket; allow generous slack.
    for (const b of buckets) {
      expect(b).toBeGreaterThan(800);
      expect(b).toBeLessThan(1200);
    }
  });

  it('accepts seed 0 rather than treating it as unset', () => {
    const rand = createRng(0);
    expect(rand).not.toBe(Math.random);
    expect(createRng(0)()).toBe(rand());
  });

  it('coerces negative and fractional seeds deterministically', () => {
    expect(createRng(-1)()).toBe(createRng(-1)());
    expect(createRng(1.5)()).toBe(createRng(1.5)());
  });
});
