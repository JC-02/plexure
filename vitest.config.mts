import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * The React wrapper imports `plexure` by package name, which would resolve to the built
 * dist. Point it at source so the tests exercise what is being edited and do not silently
 * pass against a stale build.
 */
const coreSrc = fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url));

/**
 * Two projects, deliberately.
 *
 * `node` runs where `window` and `document` do not exist — the only place the SSR guard
 * (an invariant: importing the package must never throw on a server) can actually be
 * tested, plus the pure-logic modules that have no business needing a DOM.
 *
 * `browser` runs everything else in real headless chromium. The library is canvas-first;
 * jsdom has no canvas, so mocking it would mean asserting against the mock rather than
 * against the thing that ships.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { plexure: coreSrc } },
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/**/*.node.test.ts'],
        },
      },
      {
        resolve: { alias: { plexure: coreSrc } },
        test: {
          name: 'browser',
          include: ['packages/*/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.node.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
