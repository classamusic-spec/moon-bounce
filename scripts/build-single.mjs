// Inlines the Vite build (dist/) into a single self-contained HTML file that
// runs by double-clicking (Three.js is bundled into the JS). Run after
// `npm run build`. Output: moon-bounce-app.html
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const dist = resolve('dist');
let html = readFileSync(resolve(dist, 'index.html'), 'utf8');

const assetPath = (href) => resolve(dist, href.replace(/^\.?\//, ''));

// drop modulepreload hints (the asset gets inlined, so the preload would 404)
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>\s*/g, '');

// inline the stylesheet(s)
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => {
  const css = readFileSync(assetPath(href), 'utf8');
  return `<style>\n${css}\n</style>`;
});

// inline the module script(s)
html = html.replace(/<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g, (_, _a, src) => {
  let js = readFileSync(assetPath(src), 'utf8');
  js = js.replace(/<\/script>/gi, '<\\/script>'); // avoid breaking out of the tag
  return `<script type="module">\n${js}\n</script>`;
});

const out = resolve('moon-bounce-app.html');
writeFileSync(out, html);
console.log('wrote', out, '(' + Math.round(html.length / 1024) + ' KB)');
