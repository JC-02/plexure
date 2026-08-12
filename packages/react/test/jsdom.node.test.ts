// @vitest-environment jsdom

import type { PlexureInstance } from 'plexure';
import type { ReactElement } from 'react';
import { act, createElement, createRef, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Plexure } from '../src/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The scenario that actually matters for adoption: someone unit-tests a page that happens
 * to contain a <Plexure />, in the jsdom environment every React project defaults to.
 * Rendering it must be a non-event — no mock, no setup file, no crash.
 */
const roots: Array<() => void> = [];

function render(element: ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  roots.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

afterEach(() => {
  for (const dispose of roots.splice(0)) dispose();
});

describe('<Plexure /> in jsdom', () => {
  it('renders without throwing', () => {
    expect(() => render(createElement(Plexure))).not.toThrow();
  });

  it('still renders its host div, so surrounding layout is unaffected', () => {
    const container = render(createElement(Plexure, { className: 'field' }));
    const host = container.querySelector('[data-plexure]') as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.className).toBe('field');
  });

  it('adds no canvas, because there is nothing to paint with', () => {
    const container = render(createElement(Plexure));
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('renders children of a page that contains it', () => {
    const container = render(
      createElement('main', null, createElement(Plexure), createElement('h1', null, 'Hello')),
    );
    expect(container.querySelector('h1')?.textContent).toBe('Hello');
  });

  it('survives StrictMode double mounting', () => {
    expect(() => render(createElement(StrictMode, null, createElement(Plexure)))).not.toThrow();
  });

  it('unmounts cleanly', () => {
    render(createElement(Plexure));
    expect(() => {
      for (const dispose of roots.splice(0)) dispose();
    }).not.toThrow();
  });

  it('exposes a ref handle that is safe to drive', () => {
    const ref = createRef<PlexureInstance>();
    render(createElement(Plexure, { ref, count: 30 }));
    expect(ref.current).not.toBeNull();
    expect(ref.current?.isRunning).toBe(false);
    expect(() => {
      ref.current?.setOptions({ intensity: 0.4 });
      ref.current?.pause();
      ref.current?.resume();
      ref.current?.refresh();
    }).not.toThrow();
  });

  it('accepts a full options payload without validating in a hostile way', () => {
    expect(() =>
      render(
        createElement(Plexure, {
          count: 50,
          seed: 7,
          intensity: 0.8,
          star: { color: 'var(--brand, #fff)' },
          link: { distance: '30%' },
          cursor: { enabled: false },
        }),
      ),
    ).not.toThrow();
  });
});
