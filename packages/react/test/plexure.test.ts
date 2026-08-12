import type { PlexureInstance } from 'plexure';
import type { ReactElement } from 'react';
import { act, createElement, createRef, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countCalls } from '../../core/test/helpers';
import { Plexure, type PlexureProps } from '../src/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The component talks to the core field through `fieldRef`, not through the imperative
 * handle it exposes — so spying on the ref would never observe what the effects actually
 * do. This wraps the factory instead and records every field the component creates.
 */
const { created } = vi.hoisted(() => ({ created: [] as PlexureInstance[] }));

vi.mock('plexure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('plexure')>();
  return {
    ...actual,
    createPlexure: (...args: Parameters<typeof actual.createPlexure>) => {
      const instance = actual.createPlexure(...args);
      created.push(instance);
      return instance;
    },
  };
});

/** The live field behind the most recently mounted component. */
function lastField(): PlexureInstance {
  const field = created.at(-1);
  if (!field) throw new Error('no field was created');
  return field;
}

const mounted: Array<{ unmount: () => void; container: HTMLElement }> = [];

function render(element: ReactElement) {
  const container = document.createElement('div');
  container.style.cssText = 'width:400px;height:300px';
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  const handle = {
    container,
    rerender: (next: ReactElement) =>
      act(() => {
        root.render(next);
      }),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
  mounted.push(handle);
  return handle;
}

afterEach(() => {
  for (const m of mounted.splice(0)) {
    try {
      m.unmount();
    } catch {
      m.container.remove();
    }
  }
  created.length = 0;
});

/** The host div must be sized, or the field measures zero and never runs. */
const FILL: PlexureProps = { style: { width: '400px', height: '300px' }, maxDpr: 1 };

function canvases(container: HTMLElement): HTMLCanvasElement[] {
  return [...container.querySelectorAll('canvas')];
}

/** Particle count, read as arcs drawn in the single frame `pause()` renders. */
function particleCount(field: PlexureInstance): number {
  field.pause();
  return countCalls('arc', () => field.refresh());
}

describe('<Plexure />', () => {
  it('renders a marked host div', () => {
    const { container } = render(createElement(Plexure, FILL));
    const host = container.querySelector('[data-plexure]');
    expect(host).not.toBeNull();
    expect(host?.tagName).toBe('DIV');
  });

  it('mounts a field into the host', () => {
    const { container } = render(createElement(Plexure, FILL));
    expect(canvases(container)).toHaveLength(1);
  });

  it('passes className and style through to the host', () => {
    const { container } = render(createElement(Plexure, { ...FILL, className: 'bg-field' }));
    const host = container.querySelector('[data-plexure]') as HTMLElement;
    expect(host.className).toBe('bg-field');
    expect(host.style.width).toBe('400px');
  });

  it('forwards options to the field on mount', () => {
    const ref = createRef<PlexureInstance>();
    render(createElement(Plexure, { ...FILL, ref, count: 42 }));
    expect(particleCount(ref.current as PlexureInstance)).toBe(42);
  });

  it('destroys the field on unmount', () => {
    const { container, unmount } = render(createElement(Plexure, FILL));
    expect(canvases(container)).toHaveLength(1);
    unmount();
    expect(canvases(container)).toHaveLength(0);
  });
});

describe('StrictMode', () => {
  // React runs mount → unmount → mount in development. A field that leaked on the throwaway
  // mount would leave two canvases and two rAF subscriptions behind.
  it('leaves exactly one canvas after the double mount', () => {
    const { container } = render(createElement(StrictMode, null, createElement(Plexure, FILL)));
    expect(canvases(container)).toHaveLength(1);
  });

  it('leaves a live, running field after the double mount', () => {
    const ref = createRef<PlexureInstance>();
    render(createElement(StrictMode, null, createElement(Plexure, { ...FILL, ref, count: 30 })));
    expect(ref.current?.isRunning).toBe(true);
    expect(particleCount(ref.current as PlexureInstance)).toBe(30);
  });

  it('cleans up fully on unmount from StrictMode', () => {
    const { container, unmount } = render(
      createElement(StrictMode, null, createElement(Plexure, FILL)),
    );
    unmount();
    expect(canvases(container)).toHaveLength(0);
  });
});

describe('ref handle', () => {
  it('exposes the instance surface', () => {
    const ref = createRef<PlexureInstance>();
    render(createElement(Plexure, { ...FILL, ref }));
    for (const method of ['setOptions', 'pause', 'resume', 'refresh', 'destroy'] as const) {
      expect(typeof ref.current?.[method]).toBe('function');
    }
  });

  it('reports and controls the running state', () => {
    const ref = createRef<PlexureInstance>();
    render(createElement(Plexure, { ...FILL, ref }));
    expect(ref.current?.isRunning).toBe(true);
    ref.current?.pause();
    expect(ref.current?.isRunning).toBe(false);
    ref.current?.resume();
    expect(ref.current?.isRunning).toBe(true);
  });

  it('stays safe to call after unmount', () => {
    const ref = createRef<PlexureInstance>();
    const { unmount } = render(createElement(Plexure, { ...FILL, ref }));
    // Captured before unmount: React nulls `ref.current`, so reading through it afterwards
    // would test nothing. This exercises the delegating handle's own null guard.
    const handle = ref.current as PlexureInstance;
    unmount();

    expect(ref.current).toBeNull();
    expect(() => {
      handle.setOptions({ density: 1000 });
      handle.pause();
      handle.resume();
      handle.refresh();
      handle.destroy();
    }).not.toThrow();
    expect(handle.isRunning).toBe(false);
  });
});

describe('option updates', () => {
  it('applies changed options without remounting the field', () => {
    const ref = createRef<PlexureInstance>();
    const { container, rerender } = render(createElement(Plexure, { ...FILL, ref, count: 20 }));
    const before = canvases(container)[0];
    expect(particleCount(ref.current as PlexureInstance)).toBe(20);

    rerender(createElement(Plexure, { ...FILL, ref, count: 55 }));
    expect(particleCount(ref.current as PlexureInstance)).toBe(55);
    // Same canvas element: updated in place, not torn down and rebuilt.
    expect(canvases(container)[0]).toBe(before);
  });

  it('does not push options again when nothing changed', () => {
    const { rerender } = render(createElement(Plexure, { ...FILL, count: 20 }));
    const spy = vi.spyOn(lastField(), 'setOptions');

    // A new object literal with identical content — the serialised key should absorb it.
    rerender(createElement(Plexure, { ...FILL, count: 20 }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('pushes options exactly once when they do change', () => {
    const { rerender } = render(createElement(Plexure, { ...FILL, count: 20 }));
    const spy = vi.spyOn(lastField(), 'setOptions');

    rerender(createElement(Plexure, { ...FILL, count: 21 }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ count: 21 }));
  });

  it('re-applies when a Path2D clipTo identity changes', () => {
    const first = new Path2D();
    first.rect(0, 0, 100, 100);
    const { rerender } = render(createElement(Plexure, { ...FILL, clipTo: first }));
    const spy = vi.spyOn(lastField(), 'setOptions');

    // A Path2D does not JSON-serialise, so the serialised key cannot see this change —
    // identity is deped separately, and that is what this guards.
    const second = new Path2D();
    second.rect(0, 0, 50, 50);
    rerender(createElement(Plexure, { ...FILL, clipTo: second }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ clipTo: second }));
  });

  it('does not re-apply when the same Path2D is passed again', () => {
    const path = new Path2D();
    path.rect(0, 0, 100, 100);
    const { rerender } = render(createElement(Plexure, { ...FILL, clipTo: path }));
    const spy = vi.spyOn(lastField(), 'setOptions');

    rerender(createElement(Plexure, { ...FILL, clipTo: path }));
    expect(spy).not.toHaveBeenCalled();
  });
});
