# plexure

A drifting field of points connected by lines, reacting to the pointer. It goes where you
put it. A hero, a card, an odd shape, or several containers sharing one field. ~6 kB
gzipped, zero dependencies.

<!-- TODO(demo): drop the GIF here once recorded, using an absolute raw.githubusercontent
     URL so it survives being rendered outside GitHub. -->

| Package | |
|---|---|
| [`plexure`](packages/core) | The engine. Zero dependencies. |
| [`@plexure/react`](packages/react) | A component wrapper, under 500 B. |

Docs and playground: [plexure.dev](https://plexure.dev) *(coming soon)*

## Development

```sh
npm install
npm run build       # all packages
npm run typecheck
npm run lint
npm test            # node + headless chromium
```

Serve the repo root with `npx http-server -c-1 .` and open `/apps/playground/` for the dev
harness. The `-c-1` disables caching, so you get the bundle from your last build.

The harness is eight pages of manual checks, one per behaviour.

## Layout

```
packages/core     the engine
packages/react    the React wrapper
apps/playground   the manual test harness
```

## License

MIT © Jordan Cowan
