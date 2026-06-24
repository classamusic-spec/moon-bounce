import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/tmp/claude-0/-home-user-moon-bounce/47e83da3-ea4e-5cb2-94cd-900277ba5982/scratchpad/shots';
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await (await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2 })).newPage();
await page.goto('http://localhost:4173/', { waitUntil:'load' });
await page.waitForFunction(() => !!window.__game);
// Saturn power box (ice, blue) is at -30; frame it directly, frozen so it isn't grabbed
await page.evaluate(() => { document.getElementById('splash').classList.add('hide'); window.__game.goToPlanet(5); });
await page.waitForTimeout(500);
await page.evaluate(() => { const g=window.__game; g.paused=true; });
for (let i=0;i<26;i++){ await page.evaluate(()=>{ const g=window.__game; g.charPos.x=-30; g.charPos.y=2.2; g.char.position.set(-30,2.2,0); g.stage.camera.position.x=-30; }); await page.waitForTimeout(40); }
console.log('powerbox at', await page.evaluate(()=>window.__game.powerBox ? [window.__game.powerBox.x, +window.__game.powerBox.group.position.y.toFixed(1)] : null));
await page.screenshot({ path: `${OUT}/powerbox-icon.png` });
await browser.close();
