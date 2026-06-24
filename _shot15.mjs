import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/tmp/claude-0/-home-user-moon-bounce/47e83da3-ea4e-5cb2-94cd-900277ba5982/scratchpad/shots';
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await (await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2 })).newPage();
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto('http://localhost:4173/', { waitUntil:'load' });
await page.waitForFunction(() => !!window.__game);

// URANUS: ice freezes a frost cloud into a step
await page.evaluate(() => { document.getElementById('splash').classList.add('hide'); window.__game.goToPlanet(6); });
await page.waitForTimeout(500);
console.log('URANUS freezables:', await page.evaluate(()=>window.__game.freezables.length), 'power:', await page.evaluate(()=>window.__game.currentPower));
await page.evaluate(() => { const g=window.__game; g.powerActive=true; g.currentPower='ice'; g.ui.setPuffVisible(true); g.charPos.x=0; g.charPos.y=28; g.facing=1; });
let ok=false,t=0;
while(t++<14 && !ok){ await page.evaluate(()=>{ const g=window.__game; g.charPos.x=0; g.charPos.y=28; g.facing=1; g.castPuff(); }); await page.waitForTimeout(450); ok=await page.evaluate(()=>window.__game.freezables.some(f=>f.frozen)); }
console.log('URANUS froze a cloud:', ok, 'plats:', await page.evaluate(()=>window.__game.platforms.length));
await page.evaluate(() => { const g=window.__game; g.paused=true; g.charPos.x=3; g.charPos.y=28.7; });
for(let i=0;i<14;i++){ await page.evaluate(()=>{ const g=window.__game; g.charPos.x=3; g.charPos.y=28.7; g.char.position.set(3,28.7,0); }); await page.waitForTimeout(40); }
await page.screenshot({ path: `${OUT}/uranus-icestep.png` });

// MARS pit shading (re-check)
await page.evaluate(() => { const g=window.__game; g.paused=false; window.__game.goToPlanet(3); });
await page.waitForTimeout(500);
await page.evaluate(() => { const g=window.__game; g.paused=true; });
for(let i=0;i<26;i++){ await page.evaluate(()=>{ const g=window.__game; g.charPos.x=12; g.charPos.y=1.2; g.char.position.set(12,1.2,0); g.stage.camera.position.x=12; }); await page.waitForTimeout(40); }
await page.screenshot({ path: `${OUT}/mars-pit2.png` });
console.log('done');
await browser.close();
