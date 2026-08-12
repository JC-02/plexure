import { afterEach, describe, expect, it } from 'vitest';
import { startTick, stopTick } from '../src/ticker';
import { nextFrames, wait } from './helpers';

const running = new Set<(dt: number) => void>();
function subscribe(fn: (dt: number) => void): (dt: number) => void {
  running.add(fn);
  startTick(fn);
  return fn;
}
afterEach(() => {
  for (const fn of running) stopTick(fn);
  running.clear();
});

/** Count rAF scheduling calls over a span, to prove how many loops are actually running. */
async function scheduledOver(ms: number): Promise<number> {
  const original = window.requestAnimationFrame;
  let scheduled = 0;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    scheduled++;
    return original.call(window, cb);
  }) as typeof window.requestAnimationFrame;
  try {
    await wait(ms);
  } finally {
    window.requestAnimationFrame = original;
  }
  return scheduled;
}

describe('shared ticker', () => {
  it('drives a subscriber', async () => {
    const seen: number[] = [];
    subscribe((dt) => seen.push(dt));
    await nextFrames(3);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('hands the very first tick a dt of exactly 1', async () => {
    const seen: number[] = [];
    subscribe((dt) => seen.push(dt));
    await nextFrames(2);
    // No previous timestamp to difference against, so the engine assumes one 60 fps frame
    // rather than teleporting particles.
    expect(seen[0]).toBe(1);
  });

  it('clamps dt into [0.25, 3]', async () => {
    const seen: number[] = [];
    subscribe((dt) => seen.push(dt));
    await nextFrames(8);
    for (const dt of seen) {
      expect(dt).toBeGreaterThanOrEqual(0.25);
      expect(dt).toBeLessThanOrEqual(3);
    }
  });

  it('ignores a duplicate subscription', async () => {
    let calls = 0;
    const fn = () => calls++;
    subscribe(fn);
    startTick(fn);
    await nextFrames(4);
    const perFrame = calls / 4;
    // Would be ~2 if the same function had been registered twice.
    expect(perFrame).toBeLessThan(1.5);
  });

  // The invariant: N fields cost one rAF loop, not N.
  it('runs one loop no matter how many subscribers there are', async () => {
    const aTicks: number[] = [];
    const bTicks: number[] = [];
    const cTicks: number[] = [];
    subscribe((dt) => aTicks.push(dt));
    subscribe((dt) => bTicks.push(dt));
    subscribe((dt) => cTicks.push(dt));

    const scheduled = await scheduledOver(150);

    // Three subscribers, each ticked once per frame, but only one frame scheduled per frame.
    expect(aTicks.length).toBeGreaterThan(2);
    expect(scheduled).toBeLessThanOrEqual(aTicks.length + 2);
    expect(scheduled).toBeLessThan(aTicks.length * 2);
  });

  it('gives every subscriber the identical dt within a frame', async () => {
    const a: number[] = [];
    const b: number[] = [];
    subscribe((dt) => a.push(dt));
    subscribe((dt) => b.push(dt));
    await nextFrames(5);
    const n = Math.min(a.length, b.length);
    expect(n).toBeGreaterThan(1);
    expect(a.slice(0, n)).toEqual(b.slice(0, n));
  });

  it('keeps ticking the survivors when one unsubscribes', async () => {
    let aCalls = 0;
    let bCalls = 0;
    const a = subscribe(() => aCalls++);
    subscribe(() => bCalls++);
    await nextFrames(3);
    stopTick(a);
    running.delete(a);
    const aAtStop = aCalls;
    const bAtStop = bCalls;
    await nextFrames(3);
    expect(aCalls).toBe(aAtStop);
    expect(bCalls).toBeGreaterThan(bAtStop);
  });

  it('stops scheduling entirely once the last subscriber leaves', async () => {
    const fn = subscribe(() => {});
    await nextFrames(2);
    stopTick(fn);
    running.delete(fn);
    expect(await scheduledOver(120)).toBe(0);
  });

  it('restarts cleanly after going idle, with dt reset to 1', async () => {
    const first: number[] = [];
    const fn = subscribe((dt) => first.push(dt));
    await nextFrames(2);
    stopTick(fn);
    running.delete(fn);
    await wait(60);

    const second: number[] = [];
    subscribe((dt) => second.push(dt));
    await nextFrames(2);
    // The stale timestamp from before the idle gap must not leak in as a huge dt.
    expect(second[0]).toBe(1);
  });

  it('tolerates stopping a tick that was never started', () => {
    expect(() => stopTick(() => {})).not.toThrow();
  });
});
