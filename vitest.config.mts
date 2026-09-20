import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Two test layers, and the split is deliberate.
 *
 * `node` (jsdom absent) runs the pure model in `lib/` — it needs no DOM, and
 * running it without one is what keeps it honest: a "pure" module that reaches
 * for `document` fails here rather than passing by accident.
 *
 * `jsdom` runs the component layer in `components/`, `drawers/` and `stores/`:
 * render a component, drive it with real user events, assert what the user sees
 * (React Testing Library) or what was persisted (the store). This is the layer
 * the Playwright suite cannot give us — it runs in-process in milliseconds, so a
 * behaviour like "type a title, press Escape, the edit is stored" is checked
 * without a browser, a server, or a build.
 *
 * Playwright still owns what only a real browser can answer: layout, computed
 * style, drag gestures, `file://`, real storage, cross-tab events.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    // Forks time out on this machine: worker startup alone exceeds the 60s
    // default before a single test runs, and it is not a code problem — a bare
    // Playwright script that does 3s of work takes ~170s of wall clock here.
    // Threads start in-process and skip that cost, and one thread keeps two
    // jsdom environments from competing for the same machine.
    pool: 'threads',
    maxWorkers: 1,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'model',
          environment: 'node',
          include: ['lib/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          setupFiles: ['tests/component-setup.ts'],
          include: ['components/**/*.test.tsx', 'stores/**/*.test.ts'],
        },
      },
    ],
  },
});
