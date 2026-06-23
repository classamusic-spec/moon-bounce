import { defineConfig } from 'vite';

// Moon Bounce — Vite config.
// `base: './'` keeps asset paths relative so the built app works both from a
// web server and when wrapped as a native app (Capacitor loads from file://).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
