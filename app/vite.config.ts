import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const BUILDER = resolve(here, '../style/build.mjs');

/**
 * Re-runs style/build.mjs when it changes, so editing the palette
 * regenerates cyberpunk.json and Vite's HMR reloads the style on the map.
 * A single `npm run dev` and zero extra dependencies.
 */
function styleBuilder(): Plugin {
  const run = () => {
    try {
      execFileSync(process.execPath, [BUILDER], { stdio: 'inherit' });
    } catch {
      // The error was already printed via stdio; don't crash the dev server.
    }
  };
  return {
    name: 'games-map:style-builder',
    buildStart: run,
    configureServer(server: ViteDevServer) {
      server.watcher.add(BUILDER);
      server.watcher.on('change', (file) => {
        if (resolve(file) === BUILDER) run();
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the app under /<repo>/; the deploy workflow sets BASE.
  base: process.env.BASE || '/',
  plugins: [styleBuilder()],
  server: {
    // The canonical style lives in ../style, outside Vite's root.
    fs: { allow: [resolve(here, '..')] },
    // Not hardcoded: 5173 collides with other projects that already use it.
    port: Number(process.env.PORT) || 5173,
  },
});
