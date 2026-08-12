/**
 * Harness-only: draw the outline of a clip shape over its host, so you can see where the
 * boundary actually is and judge whether particles respect it. Not part of the library.
 *
 * Handles the three forms the harness uses:
 *   CSS `polygon(x% y%, …)`  — percentages resolve against width and height independently,
 *                              so a 0..100 viewBox with preserveAspectRatio="none" is exact.
 *   CSS `path('M …')`        — user units are pixels of the border box, so the viewBox is
 *                              the element's own size, 1:1.
 *   `{ d, fit }`             — the library's sim-aware form. SVG's `meet`/`slice` are the
 *                              same maths as `fit: 'contain'`/`'cover'`, against the path's
 *                              tight bounding box.
 */
(() => {
  const NS = 'http://www.w3.org/2000/svg';

  /** Tight bounds of path data. getBBox reads zeros while detached, so measure attached. */
  function boundsOf(d) {
    const svg = document.createElementNS(NS, 'svg');
    svg.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    document.body.appendChild(svg);
    try {
      const b = path.getBBox();
      return b.width > 0 && b.height > 0 ? b : null;
    } catch {
      return null;
    } finally {
      svg.remove();
    }
  }

  /** Exposed so a page can reproduce the library's `fit` maths for a hand-built Path2D. */
  window.pathBounds = boundsOf;

  /** The matrix the library's `fit: 'contain' | 'cover'` applies for a given box. */
  window.fitMatrix = (d, width, height, fit) => {
    const b = boundsOf(d);
    if (!b) return new DOMMatrix();
    const scale =
      fit === 'cover'
        ? Math.max(width / b.width, height / b.height)
        : Math.min(width / b.width, height / b.height);
    return new DOMMatrix([
      scale,
      0,
      0,
      scale,
      (width - b.width * scale) / 2 - b.x * scale,
      (height - b.height * scale) / 2 - b.y * scale,
    ]);
  };

  function makeSvg(host) {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const svg = document.createElementNS(NS, 'svg');
    svg.dataset.outline = '';
    // Above the canvas (z-index 0) but below any labels (z-index 1), and never clickable.
    svg.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0';
    host.appendChild(svg);
    return svg;
  }

  /** Plain solid white, so the boundary reads the same on every shape and background. */
  function styleShape(el) {
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', '#ffffff');
    el.setAttribute('stroke-width', '1');
    el.setAttribute('stroke-linejoin', 'round');
    // Keeps the line an even 1px however the viewBox is scaled by fit/preserveAspectRatio.
    el.setAttribute('vector-effect', 'non-scaling-stroke');
  }

  /**
   * @param host  element the field is mounted in
   * @param spec  a CSS clip-path string, or { d, fit } for the sim-aware form
   */
  window.outlineShape = (host, spec) => {
    if (!spec) return null;
    const existing = host.querySelector(':scope > svg[data-outline]');
    if (existing) existing.remove();

    // --- sim-aware { d, fit } ------------------------------------------------
    if (typeof spec === 'object') {
      const { d, fit } = spec;
      const svg = makeSvg(host);
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      styleShape(path);
      if (fit === 'none') {
        svg.setAttribute('viewBox', `0 0 ${host.clientWidth} ${host.clientHeight}`);
        svg.setAttribute('preserveAspectRatio', 'none');
      } else {
        const b = boundsOf(d);
        if (!b) {
          svg.remove();
          return null;
        }
        svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`);
        svg.setAttribute(
          'preserveAspectRatio',
          fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet',
        );
      }
      svg.appendChild(path);
      return svg;
    }

    // --- CSS polygon(…) ------------------------------------------------------
    const polygon = /^polygon\(([^)]*)\)$/.exec(spec.trim());
    if (polygon) {
      const points = polygon[1]
        .split(',')
        .map((pair) =>
          pair
            .trim()
            .split(/\s+/)
            .map((n) => Number.parseFloat(n))
            .join(','),
        )
        .join(' ');
      const svg = makeSvg(host);
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      const el = document.createElementNS(NS, 'polygon');
      el.setAttribute('points', points);
      styleShape(el);
      svg.appendChild(el);
      return svg;
    }

    // --- CSS path('…') -------------------------------------------------------
    const cssPath = /^path\(\s*(['"])([\s\S]*?)\1\s*\)$/.exec(spec.trim());
    if (cssPath) {
      const svg = makeSvg(host);
      svg.setAttribute('viewBox', `0 0 ${host.clientWidth} ${host.clientHeight}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      const el = document.createElementNS(NS, 'path');
      el.setAttribute('d', cssPath[2]);
      styleShape(el);
      svg.appendChild(el);
      return svg;
    }

    // --- CSS circle(r at cx cy) / ellipse(rx ry at cx cy) --------------------
    const round = /^(circle|ellipse)\(([^)]*)\)$/.exec(spec.trim());
    if (round) {
      const w = host.clientWidth;
      const h = host.clientHeight;
      const [radii, at] = round[2].split(/\s+at\s+/);
      const r = radii
        .trim()
        .split(/\s+/)
        .map((n) => Number.parseFloat(n) / 100);
      const c = (at || '50% 50%')
        .trim()
        .split(/\s+/)
        .map((n) => Number.parseFloat(n) / 100);
      const svg = makeSvg(host);
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      const el = document.createElementNS(NS, 'ellipse');
      el.setAttribute('cx', c[0] * w);
      el.setAttribute('cy', (c[1] === undefined ? c[0] : c[1]) * h);
      if (round[1] === 'circle') {
        // A percentage circle radius resolves against the box's diagonal over root two,
        // so it stays a true circle in a non-square box.
        const ref = Math.sqrt((w * w + h * h) / 2);
        el.setAttribute('rx', r[0] * ref);
        el.setAttribute('ry', r[0] * ref);
      } else {
        el.setAttribute('rx', r[0] * w);
        el.setAttribute('ry', (r[1] === undefined ? r[0] : r[1]) * h);
      }
      styleShape(el);
      svg.appendChild(el);
      return svg;
    }

    // inset() and friends are not outlined; nothing in the harness uses them.
    return null;
  };
})();
