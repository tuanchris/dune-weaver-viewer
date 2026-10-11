// CI smoke test: drives the installed Windows app's WebView2 over CDP, checks
// both pages load the pattern, and saves a Fast screenshot into the folder given.
import {chromium} from 'playwright-core';

const out = process.argv[2], sleep = ms => new Promise(r => setTimeout(r, ms));
let browser, error;
for (let i = 0; !browser && i < 60; i++) browser = await chromium.connectOverCDP('http://127.0.0.1:9222').catch(e => { error = e; return sleep(1000); });
if (!browser) throw new Error(`The app's WebView2 never answered on CDP: ${error?.message}`);
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.waitForEvent('page');
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.waitForFunction(() => /points/.test(document.querySelector('#status')?.textContent), null, {timeout: 30000});
console.log('Fast:', await page.textContent('#status'));
await sleep(4000);
await page.screenshot({path: `${out}/fast.png`});

// The runner has no GPU, so the engine runs on software WebGL and saturates it:
// check that the Sand page draws a couple of frames without errors, then stop
// (the workflow screenshots the desktop and closes the app).
await page.click('nav a[data-mode=sand]');
await page.waitForURL(/index\.html/);
const sand = await page.evaluate(() => new Promise(r => {
  const tick = () => { const s = document.getElementById('status').textContent; s.startsWith('Loading') ? requestAnimationFrame(tick) : r(s); };
  tick();
}));
console.log('Sand:', sand);
if (/unavailable|No theta-rho/.test(sand) || errors.length) throw new Error(`Sand page failed: ${errors.join('; ') || sand}`);
await browser.close();
