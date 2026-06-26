// Headless smoke/playtest of the built single-file game (moon-bounce-app.html).
// Run after `npm run build:single`. Exits non-zero on any failure (for CI).
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';

function findChromium() {
  if (process.env.PW_CHROMIUM && existsSync(process.env.PW_CHROMIUM)) return process.env.PW_CHROMIUM;
  const bases = ['/opt/pw-browsers', join(homedir(), '.cache/ms-playwright')];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      if (!d.startsWith('chromium')) continue;
      for (const exe of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = resolve(base, d, exe);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined; // let playwright-core resolve its managed browser
}

const file = resolve('moon-bounce-app.html');
if (!existsSync(file)) { console.error('✗ moon-bounce-app.html not found — run `npm run build:single` first'); process.exit(1); }

const failures = [];
const ok = (cond, label) => { if (cond) console.log('✓ ' + label); else { console.error('✗ ' + label); failures.push(label); } };

const browser = await chromium.launch({
  executablePath: findChromium(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--allow-file-access-from-files'],
});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

await page.goto('file://' + file, { waitUntil: 'load' });
const booted = await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 }).then(() => true).catch(() => false);
ok(booted, 'game boots (window.__game ready)');
ok(pageErrors.length === 0, 'no page errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));

if (booted) {
  ok(await page.evaluate(() => { const c = document.querySelector('canvas'); return !!c && c.width > 0; }), 'WebGL canvas renders');

  // every planet loads
  for (let i = 0; i < 8; i++) {
    const name = await page.evaluate((idx) => { window.__game.goToPlanet(idx); return window.__game.level.name; }, i);
    ok(typeof name === 'string' && name.length > 0, `planet ${i} loads (${name})`);
  }

  // a power can be granted + cast
  const puffed = await page.evaluate(() => {
    const g = window.__game; g.goToPlanet(0); g.powerActive = true; g.currentPower = 'flame'; g.castPuff();
    return g.puffs.length > 0;
  });
  ok(puffed, 'power puff fires');

  // settings round-trip through storage
  const persisted = await page.evaluate(() => {
    window.__game.storage.setSetting('volume', 0.5);
    return window.__game.storage.settings.volume === 0.5;
  });
  ok(persisted, 'settings persist to storage');
}

await browser.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('\nAll playtest checks passed.');
