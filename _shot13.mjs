import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/tmp/claude-0/-home-user-moon-bounce/47e83da3-ea4e-5cb2-94cd-900277ba5982/scratchpad/shots';
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await (await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2 })).newPage();
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto('http://localhost:4173/', { waitUntil:'load' });
await page.waitForFunction(() => !!window.__game);
await page.evaluate(() => { document.getElementById('splash').classList.add('hide'); window.__game.goToPlanet(0); });
await page.waitForTimeout(500);

// A) gap pit shading + 3D PUFF button (grant power, hover over a gap, freeze)
await page.evaluate(() => { const g=window.__game; g.powerActive=true; g.currentPower='flame'; g.ui.setPuffVisible(true); g.paused=true; });
for (let i=0;i<24;i++){ await page.evaluate(()=>{ const g=window.__game; g.charPos.x=3.5; g.charPos.y=-0.4; g.char.position.set(3.5,-0.4,0); }); await page.waitForTimeout(40); }
await page.screenshot({ path: `${OUT}/mercury-pit-puff.png` });

// B) Power Box icon (hover near it, frozen so it isn't grabbed)
for (let i=0;i<20;i++){ await page.evaluate(()=>{ const g=window.__game; g.charPos.x=-31; g.charPos.y=-1; g.char.position.set(-31,-1,0); }); await page.waitForTimeout(40); }
await page.screenshot({ path: `${OUT}/mercury-powerbox-icon.png` });

// C) cache collect -> Power-Master sticker
await page.evaluate(() => { const g=window.__game; g.paused=false; g.charPos.x=13; g.charPos.y=-2+4.5; }); // at cache [13,4.5]
await page.waitForTimeout(900);
const got = await page.evaluate(() => ({ master0: window.__game.storage.hasSticker('master-0'), stars: window.__game.smallStars }));
console.log('cache', JSON.stringify(got));
await browser.close();
