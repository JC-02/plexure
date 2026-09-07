# plexure

A drifting field of points connected by lines, reacting to the pointer.

<!-- TODO(demo): drop the GIF here once recorded. Use an absolute raw.githubusercontent
     URL, not a relative path, or it renders broken on npm. See the checklist in the repo. -->

Most constellation backgrounds fill a rectangle. This one goes where you put it. Drop it in
a hero, a card, an odd shape, or several containers at once.

```ts
import { createPlexure } from 'plexure';

createPlexure(document.querySelector('#hero'));
```

That is the whole setup. Everything below is optional.

## Put it in a shape, not behind one

A CSS `clip-path` or a bare `Path2D` masks the canvas. The simulation keeps running in the
box behind it, so particles drift out of the shape and vanish at its edge.

Pass an object instead and the simulation itself is confined. Particles start inside the
shape and get put back inside when they leave. The field lives in the shape.

```ts
createPlexure(hero, {
  clipTo: { path: 'M 50 3 L 61 38 L 98 38 …', fit: 'contain' },
});
```

`fit` maps the path's coordinates into the container. The same star fits a wide banner and
a square card, no edits. A ring keeps its hole empty. A sliver covering five percent of its
box still fills evenly.

## Show one field through several containers

Name the elements to show through. The field spans the wrapper behind all of them.

```ts
createPlexure(document.querySelector('#card-grid'), {
  clipTo: { windows: '.card' },
});
```

A particle leaving one card turns up in the next, because it never went anywhere. The gaps
show nothing. It reads as one field seen through openings rather than three separate
effects.

Corner radii come from each card's CSS. The mask follows them as they resize.

## Scope it anywhere

```ts
createPlexure('viewport');                      // fixed, follows the window
createPlexure('page');                          // the full scrollable document
createPlexure(document.querySelector('#card')); // one element
```

Absolute distances clamp to the container, so viewport defaults stay legible in a 300 px
card. Use `'35%'` if you would rather be explicit.

Fields on one page share a single animation loop. Only the field under the pointer reacts.
Nest them and the innermost one takes the pointer, then hands it back when you leave.

## Install

```sh
npm install plexure
```

Or skip the build step:

```html
<script src="https://unpkg.com/plexure"></script>
```

Under 10 kB gzipped, zero dependencies. ESM, CJS, and a `<script>`-tag global. Typed
options.
Safe to import on a server.

## The handle

```ts
const field = createPlexure(hero, {
  star: { color: '#ebe9e4' },
  link: { color: '#ebe9e4', distance: 130 },
  cursor: { color: '#7fd4c1', mode: 'repel' },
});

field.setOptions({ intensity: 0.5 }); // merges live, no restart, no layout reads
field.setOptions({ count: null });    // null clears an option back to its default
field.pause();
field.resume();
field.refresh();                      // force a re-measure
field.destroy();                      // removes the canvas and every listener
field.isRunning;
```

`setOptions` merges, so leaving a key out leaves that option alone. Pass `null` to clear
one. `count: null` goes back to counting from `density`, `seed: null` to unseeded placement.

It reads no layout and restarts nothing, so `intensity` is cheap to drive from scroll.

The [`PlexureOptions` type](https://github.com/JC-02/plexure/blob/main/packages/core/src/types.ts)
lists every option and its default. Colours take any CSS colour, including
`var(--custom-properties)`. Distances take pixels or `'35%'`-style fractions of the smaller
edge.

## Guarantees

A field is decoration. It must never be the reason a page breaks.

- **It cannot take clicks, selection or focus.** The canvas is `pointer-events: none`,
  `aria-hidden`, unfocusable, and `contain: strict`.
- **It never blocks scrolling.** Every listener is passive. None call `preventDefault`.
- **It stops rather than spams.** A frame that throws is caught. Three failures in a row
  and the field pauses itself and warns once. `resume()` brings it back.
- **It reaches nothing.** No network, no storage, no cookies, no `eval`. It runs under a
  strict Content-Security-Policy.
- **It imports safely on a server.** Anywhere it cannot paint, jsdom included, you get an
  inert handle. Component tests need no mocking.
- **`destroy()` is complete and idempotent.** Every listener and observer goes back.
- **Bad options degrade instead of throwing.** An unreadable colour falls back to white. A
  zero-size container does nothing. Absurd counts and distances are clamped.
- **It gets out of the way.** It honours `prefers-reduced-motion`, stops when the tab is
  hidden or scrolled off screen, and stays sharp on HiDPI displays.

Each of those is a test rather than a promise.

## React

[`@plexure/react`](https://github.com/JC-02/plexure/tree/main/packages/react) wraps this in
a component and keeps the handle on a ref.

## License

MIT © Jordan Cowan
