# @plexure/react

React bindings for [plexure](https://www.npmjs.com/package/plexure) — a drifting field of
points connected by lines, reacting to the pointer. Under 5 kB gzipped, zero dependencies.

## Install

```sh
npm install @plexure/react
```

## Use

```tsx
import { Plexure } from '@plexure/react';

function Hero() {
  return (
    <section style={{ position: 'relative' }}>
      <Plexure
        className="absolute-fill" /* position the host div yourself */
        star={{ color: 'var(--ink)' }}
        link={{ distance: 130 }}
        cursor={{ color: '#7fd4c1' }}
      />
      <h1>Your content</h1>
    </section>
  );
}
```

`<Plexure />` renders a host `div`, mounts the field into it on mount, applies prop changes
live through `setOptions` (no restart, no layout reads — safe to drive `intensity` from
scroll), and destroys the field on unmount. A `ref` exposes the core handle
(`pause()`, `resume()`, `refresh()`, `destroy()`, `isRunning`).

All options are the core library's [`PlexureOptions`](https://github.com/JC-02/plexure/blob/main/packages/core/src/types.ts):
colours accept any CSS colour including `var(--custom-properties)`; distances accept px
numbers or `'35%'`-style fractions of the smaller container edge.

## License

MIT © Jordan Cowan
