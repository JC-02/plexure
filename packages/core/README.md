# plexure

A drifting field of points connected by lines, reacting to the pointer. Scope it to the
viewport, the full page, any element, or clip it to an arbitrary shape.

- **~6 kB gzipped, zero dependencies.**
- Scope to any element, not just full-screen. The engine clamps absolute distances to the
  container, so viewport defaults stay legible inside a 300 px card. Relative units like
  `'35%'` work too.
- Mask the field with any CSS `clip-path` or a `Path2D`, or confine the simulation itself
  to a shape so particles live inside it instead of drifting out behind a mask.
- Several fields on one page share a single animation loop, and only the hovered one
  reacts to the pointer.
- Correct by default: honours `prefers-reduced-motion`, pauses when the tab is hidden or
  the container is off-screen, renders sharp on HiDPI displays.
- ESM, CJS, and a `<script>`-tag global build. Typed options. SSR-safe imports.

## Install

```sh
npm install plexure
```

Or with no build step:

```html
<script src="https://unpkg.com/plexure"></script>
```

## Use

```ts
import { createPlexure } from 'plexure';

// Fill an element
const field = createPlexure(document.querySelector('#hero'), {
  star: { color: '#ebe9e4' },
  link: { color: '#ebe9e4', distance: 130 },
  cursor: { color: '#7fd4c1' },
});

// Or the whole viewport / page
createPlexure('viewport');
createPlexure('page');

// The handle
field.setOptions({ intensity: 0.5 }); // merge live, no restart, no layout reads
field.pause();
field.resume();
field.refresh(); // force a re-measure
field.destroy(); // removes the canvas and every listener
field.isRunning;
```

The [`PlexureOptions` type](https://github.com/JC-02/plexure/blob/main/packages/core/src/types.ts)
documents every option and its default. Colours accept any CSS colour, including
`var(--custom-properties)`. Distances accept px numbers, or `'35%'`-style fractions of the
smaller container edge.

React bindings: [`@plexure/react`](../react).

## License

MIT © Jordan Cowan
