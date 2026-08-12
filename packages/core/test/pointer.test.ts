import { afterEach, describe, expect, it } from 'vitest';
import { createPlexure } from '../src/index';
import { cleanup, cursorLinks, mountHost, track } from './helpers';

afterEach(cleanup);

/** Dispatch a real pointer event at an offset inside the host's box. */
function pointerAt(
  el: Element,
  type: 'pointerenter' | 'pointermove' | 'pointerleave',
  offsetX = 0,
  offsetY = 0,
  origin: Element = el,
): { clientX: number; clientY: number } {
  const r = origin.getBoundingClientRect();
  const clientX = r.left + offsetX;
  const clientY = r.top + offsetY;
  el.dispatchEvent(new PointerEvent(type, { clientX, clientY, bubbles: type === 'pointermove' }));
  return { clientX, clientY };
}

describe('pointer activation', () => {
  it('draws no cursor links before the pointer arrives', () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 60, maxDpr: 1 }));
    expect(cursorLinks(field, 200, 150)).toBe(0);
  });

  it('links to the pointer once it enters the host', () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 60, maxDpr: 1 }));
    pointerAt(host, 'pointerenter', 200, 150);
    expect(cursorLinks(field, 200, 150)).toBeGreaterThan(0);
  });

  it('never exceeds cursor.maxLinks', () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 160, maxDpr: 1, cursor: { maxLinks: 3 } }));
    pointerAt(host, 'pointerenter', 200, 150);
    expect(cursorLinks(field, 200, 150)).toBeLessThanOrEqual(3);
    expect(cursorLinks(field, 200, 150)).toBeGreaterThan(0);
  });

  it('goes inert again when the pointer leaves', () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 60, maxDpr: 1 }));
    pointerAt(host, 'pointerenter', 200, 150);
    expect(cursorLinks(field, 200, 150)).toBeGreaterThan(0);
    pointerAt(host, 'pointerleave', 200, 150);
    expect(cursorLinks(field, 200, 150)).toBe(0);
  });

  it('ignores the pointer entirely when cursor.enabled is false', () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 60, maxDpr: 1, cursor: { enabled: false } }));
    pointerAt(host, 'pointerenter', 200, 150);
    expect(cursorLinks(field, 200, 150)).toBe(0);
  });

  it('never activates from pointer events outside its host', () => {
    const host = mountHost(400, 300);
    const outside = mountHost(100, 100);
    const field = track(createPlexure(host, { count: 60, maxDpr: 1 }));
    pointerAt(outside, 'pointermove', 10, 10);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 5 }));
    expect(cursorLinks(field, 200, 150)).toBe(0);
  });

  it('restores the claim on pointermove after a window blur', () => {
    const host = mountHost(400, 300);
    const field = track(createPlexure(host, { count: 60, maxDpr: 1 }));
    pointerAt(host, 'pointerenter', 200, 150);
    // A blur drops the entered state without a matching pointerleave.
    window.dispatchEvent(new Event('blur'));
    expect(cursorLinks(field, 200, 150)).toBe(0);
    // pointerenter never refires, so the move alone has to bring the field back.
    pointerAt(host, 'pointermove', 200, 150);
    expect(cursorLinks(field, 200, 150)).toBeGreaterThan(0);
  });
});

describe('data-plexure-ignore', () => {
  it('suppresses the reaction while the pointer is over an ignored child', () => {
    const host = mountHost(400, 300);
    const ignored = document.createElement('div');
    ignored.setAttribute('data-plexure-ignore', '');
    ignored.style.cssText = 'position:absolute;inset:0';
    host.appendChild(ignored);
    const field = track(createPlexure(host, { count: 60, maxDpr: 1 }));

    pointerAt(ignored, 'pointermove', 200, 150, host);
    expect(cursorLinks(field, 200, 150)).toBe(0);
  });

  it('suppresses it for descendants of an ignored element too', () => {
    const host = mountHost(400, 300);
    const ignored = document.createElement('div');
    ignored.setAttribute('data-plexure-ignore', '');
    const deep = document.createElement('span');
    ignored.appendChild(deep);
    host.appendChild(ignored);
    const field = track(createPlexure(host, { count: 60, maxDpr: 1 }));

    pointerAt(deep, 'pointermove', 200, 150, host);
    expect(cursorLinks(field, 200, 150)).toBe(0);
  });

  it('reacts again once the pointer moves back off the ignored zone', () => {
    const host = mountHost(400, 300);
    const ignored = document.createElement('div');
    ignored.setAttribute('data-plexure-ignore', '');
    host.appendChild(ignored);
    const field = track(createPlexure(host, { count: 60, maxDpr: 1 }));

    pointerAt(ignored, 'pointermove', 200, 150, host);
    expect(cursorLinks(field, 200, 150)).toBe(0);
    pointerAt(host, 'pointermove', 200, 150);
    expect(cursorLinks(field, 200, 150)).toBeGreaterThan(0);
  });
});

describe('claim stack', () => {
  it('gives the pointer to the innermost hovered field', () => {
    const outerHost = mountHost(500, 400);
    const innerHost = document.createElement('div');
    innerHost.style.cssText = 'width:200px;height:150px';
    outerHost.appendChild(innerHost);

    const outer = track(createPlexure(outerHost, { count: 80, maxDpr: 1 }));
    const inner = track(createPlexure(innerHost, { count: 80, maxDpr: 1 }));

    pointerAt(outerHost, 'pointerenter', 100, 75);
    pointerAt(innerHost, 'pointerenter', 100, 75);

    expect(cursorLinks(inner, 100, 75)).toBeGreaterThan(0);
    expect(cursorLinks(outer, 100, 75)).toBe(0);
  });

  it('hands the pointer back to the outer field when the inner one releases it', () => {
    const outerHost = mountHost(500, 400);
    const innerHost = document.createElement('div');
    innerHost.style.cssText = 'width:200px;height:150px';
    outerHost.appendChild(innerHost);

    const outer = track(createPlexure(outerHost, { count: 80, maxDpr: 1 }));
    const inner = track(createPlexure(innerHost, { count: 80, maxDpr: 1 }));

    pointerAt(outerHost, 'pointerenter', 100, 75);
    pointerAt(innerHost, 'pointerenter', 100, 75);
    pointerAt(innerHost, 'pointerleave', 100, 75);

    expect(cursorLinks(inner, 100, 75)).toBe(0);
    expect(cursorLinks(outer, 100, 75)).toBeGreaterThan(0);
  });

  // Claims can arrive innermost-first (bubble order), so ordering must come from DOM
  // containment rather than from the order the claims were made.
  it('orders by containment regardless of claim order', () => {
    const outerHost = mountHost(500, 400);
    const innerHost = document.createElement('div');
    innerHost.style.cssText = 'width:200px;height:150px';
    outerHost.appendChild(innerHost);

    const outer = track(createPlexure(outerHost, { count: 80, maxDpr: 1 }));
    const inner = track(createPlexure(innerHost, { count: 80, maxDpr: 1 }));

    // Inner claims first, then outer — the reverse of the natural enter order.
    pointerAt(innerHost, 'pointerenter', 100, 75);
    pointerAt(outerHost, 'pointerenter', 100, 75);

    expect(cursorLinks(inner, 100, 75)).toBeGreaterThan(0);
    expect(cursorLinks(outer, 100, 75)).toBe(0);
  });

  it('makes a viewport field go inert while an element field holds the pointer', () => {
    const host = mountHost(400, 300);
    const viewport = track(createPlexure('viewport', { count: 120, maxDpr: 1 }));
    const element = track(createPlexure(host, { count: 60, maxDpr: 1 }));

    const r = host.getBoundingClientRect();
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: r.left + 200, clientY: r.top + 150 }),
    );
    expect(cursorLinks(viewport, r.left + 200, r.top + 150)).toBeGreaterThan(0);

    pointerAt(host, 'pointerenter', 200, 150);
    expect(cursorLinks(viewport, r.left + 200, r.top + 150)).toBe(0);
    expect(cursorLinks(element, 200, 150)).toBeGreaterThan(0);
  });

  it('releases the claim on destroy so the outer field recovers', () => {
    const outerHost = mountHost(500, 400);
    const innerHost = document.createElement('div');
    innerHost.style.cssText = 'width:200px;height:150px';
    outerHost.appendChild(innerHost);

    const outer = track(createPlexure(outerHost, { count: 80, maxDpr: 1 }));
    const inner = createPlexure(innerHost, { count: 80, maxDpr: 1 });

    pointerAt(outerHost, 'pointerenter', 100, 75);
    pointerAt(innerHost, 'pointerenter', 100, 75);
    expect(cursorLinks(outer, 100, 75)).toBe(0);

    inner.destroy();
    expect(cursorLinks(outer, 100, 75)).toBeGreaterThan(0);
  });
});
