# plexure

A drifting field of points connected by lines, reacting to the pointer. Scope it to the
viewport, the full page, any element — or clip it to an arbitrary shape. Under 5 kB
gzipped, zero dependencies.

This is the monorepo. The packages:

| Package | What |
|---|---|
| [`plexure`](packages/core) | The engine. Zero dependencies. |
| [`@plexure/react`](packages/react) | Thin React bindings. |

Docs and playground: [plexure.dev](https://plexure.dev) *(coming with v0.3)*

## Development

```sh
npm install
npm run build       # all packages
npm run typecheck
npm run lint
```

`apps/playground/index.html` is the dev harness — serve the repo root
(`npx http-server .`) and open `/apps/playground/`.

## License

MIT © Jordan Cowan
