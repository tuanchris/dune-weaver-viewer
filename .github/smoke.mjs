// CI smoke test: drives the installed Windows app's WebView2 over CDP, checks
// both pages load the pattern, and saves screenshots into the folder given.
import {chromium} from 'playwright-core';

const out = process.argv[2], sleep = ms => new Promise(r => setTimeout(r, ms));
let browser, error;
for (let i = 0; !browser && i < 60; i++) browser = await chromium.connectOverCDP('http://127.0.0.1:9222').catch(e => { error = e; return sleep(1000); });
if (!browser) throw new Error(`The app's WebView2 never answered on CDP: ${error?.message}`);
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.waitForEvent('page');
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const status = () => page.textContent('#status');

await page.waitForFunction(() => /points/.test(document.querySelector('#status')?.textContent), null, {timeout: 30000});
console.log('Fast:', await status());
await sleep(4000);
await page.screenshot({path: `${out}/fast.png`});

await page.click('nav a[data-mode=sand]');
await page.waitForURL(/index\.html/);
await sleep(20000);
console.log('Sand:', await status());
await page.screenshot({path: `${out}/sand.png`});
if (/unavailable|No theta-rho/.test(await status()) || errors.length) throw new Error(`Page errors: ${errors.join('; ') || await status()}`);
await browser.close();
