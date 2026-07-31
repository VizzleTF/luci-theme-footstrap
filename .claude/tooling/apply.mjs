/* Save & Apply across an SPA navigation.
 *
 * navigate() empties L.Poll's queue and calls stop()+start() on every hop, on the stated grounds that
 * "the only non-view poller LuCI adds is the transient apply/reboot reachability check". That claim
 * has never been exercised: stage a uci change, walk to another page, and apply from THERE — the
 * confirmation countdown and the reconnect probe both have to survive a queue this router flushed.
 *
 * Uses system.@system[0].log_size, and puts it back afterwards.
 */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const U = (p) => '/cgi-bin/luci/' + p;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).split('\n')[0].slice(0, 120)));
await login(p, BASE);

const out = {};
const ind = () => p.evaluate(() => ({
  indicators: [...document.querySelectorAll('#indicators [data-indicator]')].map((e) => e.textContent.trim()),
  poll: L.Poll?.queue?.length ?? null,
  active: L.Poll?.active?.() ?? null
}));

await p.goto(BASE + U('admin/system/system'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);

out.orig = await p.evaluate(async () => {
  const uci = await L.require('uci');
  await uci.load('system');
  return uci.get_first('system', 'system', 'log_size');
});

/* stage a change exactly as a view's Save button does */
out.staged = await p.evaluate(async (orig) => {
  const uci = await L.require('uci');
  await uci.load('system');
  uci.set('system', uci.get_first('system', 'system', '.name'), 'log_size', String((parseInt(orig || '64', 10) || 64) + 1));
  await uci.save();
  await L.ui.changes.init();
  return true;
}, out.orig);
await p.waitForTimeout(1200);
out.afterStage = await ind();

/* walk away by SPA, twice */
for (const path of ['admin/status/processes', 'admin/network/routes']) {
  await p.evaluate((h) => {
    const a = document.querySelector(`a[href="${h}"]`);
    if (a) return a.click();
    const s = document.createElement('a'); s.href = h; document.getElementById('view').appendChild(s); s.click();
  }, U(path));
  await p.waitForTimeout(2400);
}
out.afterNav = await ind();
out.spaStillLive = await p.evaluate(() => location.pathname);

/* apply from the page we walked to */
const t0 = Date.now();
await p.evaluate(() => { L.ui.changes.apply(false); });
/* the apply overlay ends by reloading the document; wait for either that or a settled modal */
let applied = null;
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(1000);
  applied = await p.evaluate(() => ({
    modal: (document.querySelector('#modal_overlay .modal')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    overlayShown: getComputedStyle(document.getElementById('modal_overlay') || document.body).display,
    changes: document.querySelectorAll('#indicators [data-indicator="uci-changes"]').length
  })).catch(() => null);
  if (applied && applied.changes === 0 && !/Applying|Waiting|Configuration/i.test(applied.modal)) break;
}
out.applySeconds = Math.round((Date.now() - t0) / 1000);
out.applied = applied;

await p.waitForTimeout(2000);
out.final = await p.evaluate(async () => {
  const uci = await L.require('uci');
  uci.unload('system');
  await uci.load('system');
  return { log_size: uci.get_first('system', 'system', 'log_size'),
           path: location.pathname,
           indicators: [...document.querySelectorAll('#indicators [data-indicator]')].map((e) => e.textContent.trim()) };
});

/* put it back */
await p.evaluate(async (orig) => {
  const uci = await L.require('uci');
  await uci.load('system');
  uci.set('system', uci.get_first('system', 'system', '.name'), 'log_size', orig);
  await uci.save();
  await uci.apply();
}, out.orig);
await p.waitForTimeout(4000);
out.reverted = await p.evaluate(async () => {
  const uci = await L.require('uci');
  uci.unload('system'); await uci.load('system');
  return uci.get_first('system', 'system', 'log_size');
});

out.errs = [...new Set(errs)].slice(0, 6);
console.log(JSON.stringify(out, null, 1));
await b.close();
