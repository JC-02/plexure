# @plexure/react

React bindings for [plexure](https://www.npmjs.com/package/plexure), a drifting field of
points connected by lines, reacting to the pointer.

```tsx
import { Plexure } from '@plexure/react';

<Plexure cursor={{ color: '#7fd4c1' }} />
```

The wrapper is under 500 B and adds no behaviour of its own. Every option is the engine's
[`PlexureOptions`](https://github.com/JC-02/plexure/blob/main/packages/core/src/types.ts),
covered in the [engine's README](https://github.com/JC-02/plexure/tree/main/packages/core).

## Install

```sh
npm install @plexure/react plexure
```

`plexure` is a peer dependency, so you and the wrapper share one copy. Two copies would
each run their own animation loop.

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

`<Plexure />` renders a host `div` and mounts a field into it. Props are the engine's
options. Change one and it applies through `setOptions`, so nothing remounts. That makes
`intensity` cheap to drive from scroll.

Unmounting destroys the field and returns every listener.

## The handle

A `ref` gives you the engine handle:

```tsx
const field = useRef<PlexureInstance>(null);

<Plexure ref={field} />;

field.current?.pause();
field.current?.setOptions({ count: null });
```

## In your tests

Rendering `<Plexure />` in jsdom is a non-event. The engine sees it cannot paint and hands
back an inert handle. Nothing throws, and nothing needs mocking. StrictMode's double mount
leaves one canvas, not two.

## License

MIT © Jordan Cowan
