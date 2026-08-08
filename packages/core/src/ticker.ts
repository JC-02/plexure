/**
 * One shared requestAnimationFrame loop drives every field on the page. It starts when the
 * first field subscribes and stops entirely when the last one unsubscribes, so six paused
 * or destroyed fields cost nothing.
 *
 * Each tick receives dt in 60 fps frame units (1 = 16.67 ms), clamped to [0.25, 3] so
 * tab-return spikes and timer jitter never teleport particles. At exactly 60 Hz the sim is
 * pixel-identical to the original per-frame engine; at 144 Hz or a throttled 30 Hz it runs
 * at the same real-time speed.
 */
type Tick = (dt: number) => void;

const FRAME_MS = 1000 / 60;
const ticks = new Set<Tick>();
let raf = 0;
let last = 0;

const loop = (now: number) => {
  raf = requestAnimationFrame(loop);
  const dt = last ? Math.min(3, Math.max(0.25, (now - last) / FRAME_MS)) : 1;
  last = now;
  for (const tick of ticks) tick(dt);
};

export function startTick(tick: Tick): void {
  if (ticks.has(tick)) return;
  ticks.add(tick);
  if (!raf) {
    last = 0;
    raf = requestAnimationFrame(loop);
  }
}

export function stopTick(tick: Tick): void {
  if (!ticks.delete(tick)) return;
  if (ticks.size === 0 && raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}
