// Bakes the sand each table's clears leave into web/clears/ (clears.js), so the Sand
// page loads it instead of simulating the clear: every table, from the rim and from
// the centre, for BAKED_PROFILE. Run it after sync-engine.sh or a change to that
// profile; until then the page simulates the clears, since a file's name carries a
// hash of what its sand depends on. Needs Chrome:
//   npm install --no-save --prefix . playwright-core@1.64.0 && node web/bake-clears.mjs
import {chromium} from 'playwright-core';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const web = dirname(fileURLToPath(import.meta.url)), out = join(web, 'clears');
const browser = await chromium.launch({channel: 'chrome', args: ['--use-gl=angle', '--ignore-gpu-blocklist']});
try {
  const page = await browser.newPage();
  page.on('pageerror', e => { throw e; });
  // web/ served from memory, so no server needs to run.
  await page.route('http://viewer.local/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname), file = resolve(web, '.' + path);
    if (path === '/') return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Bake</title>'});
    if (!file.startsWith(web + '/')) return route.fulfill({status: 403});
    try { await route.fulfill({contentType: extname(file) === '.js' ? 'text/javascript' : 'application/octet-stream', body: await readFile(file)}); } catch { await route.fulfill({status: 404}); }
  });
  await page.goto('http://viewer.local/');
  await rm(out, {recursive: true, force: true});
  await mkdir(out);
  for (const table of ['DWP', 'DWMP', 'DWG']) for (const fromRim of [true, false]) {
    const t0 = Date.now();
    const {name, data} = await page.evaluate(async ({table, fromRim}) => {
      const {SandSim} = await import('/engine/sim/SandSim.js'), c = await import('/clears.js');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = c.RES;
      const sim = new SandSim(canvas, c.RES);
      c.configure(sim, table, c.BAKED_PROFILE);
      // The clear and one point more, so the engine never takes the clear for the whole
      // path and finishes it off; the page keeps the sand at the same chunk.
      const head = c.clearPath(sim, await c.fetchCoords(c.clearUrl(table, fromRim))), at = c.keptAt(head.length / 2 - 1);
      const path = new Float32Array(head.length + 2);
      path.set(head);
      path.set(head.subarray(-2), head.length);
      sim.loadPath(path, {clearSand: true});
      sim.advance(at);
      if (sim.cursor !== at) throw new Error(`stopped at segment ${sim.cursor}, not ${at}`);
      const bytes = c.encode(c.takeSnap(sim));
      let s = '';
      for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return {name: await c.bakedName(sim, table, fromRim), data: btoa(s)};
    }, {table, fromRim});
    const bytes = Buffer.from(data, 'base64');
    await writeFile(join(out, name), bytes);
    console.log(`${name}: ${(bytes.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
} finally {
  await browser.close();
}
