# plexure

A drifting field of points connected by lines, reacting to the pointer. Scope it to the
viewport, the full page, any element, or clip it to an arbitrary shape. ~6 kB
gzipped, zero dependencies.

This is the monorepo. The packages:

| Package | What |
|---|---|
| [`plexure`](packages/core) | The engine. Zero dependencies. |
| [`@plexure/react`](packages/react) | Thin React bindings. |

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
harness. The `-c-1` disables caching, so you get the bundle you just built.

## License

MIT © Jordan Cowan
