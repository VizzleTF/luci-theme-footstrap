/* Before/after shots for the design review: one pair per finding, on the live stand.
 *
 * Poll is stopped before the first shot so the two frames differ only by the override sheet —
 * an Overview card is rebuilt every 5 s and a moving counter reads as a layout change. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { login, PORTS } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const only = process.argv[3] || null;
/* One test for every case, numbered ones included: `07` and `07-shadow-pop` both select the modal. */
const want = (id) => !only || id.startsWith(only);
const base = `http://localhost:${PORTS[router]}`;
const OUT = fileURLToPath(new URL('../../../tmp/design-ab', import.meta.url));

/* Sections are addressed by a data-ab stamped from their h3 text: the h3 carries the collapse
 * toggle's label too ("SystemHide"), so a :has(> h3) text selector never matches. */
const SEC = (t) => `#view .cbi-section[data-ab="${t}"]`;
const STAMP = `(() => { for (const s of document.querySelectorAll('#view .cbi-section')) {
  const t = (s.querySelector('h3')?.textContent || '').replace(/Hide$|Show$/, '').trim();
  if (t) s.setAttribute('data-ab', t);
}
for (const s of document.querySelectorAll('#view .cbi-section')) {
  const hs = [...s.querySelectorAll('h3')];
  hs.slice(1).forEach((h) => h.setAttribute('data-ab-sub', '1'));
}
return [...document.querySelectorAll('#view .cbi-section[data-ab]')].map(s => s.dataset.ab); })()`;

const CASES = [
  { id: '01-accent-fill', sel: SEC('Network'), css: `
    .ifacebox .ifacebox-head.active {
      background: transparent; color: var(--fs-faint);
      font-size: var(--fs-type-xs); font-weight: var(--fs-eyebrow-weight);
      letter-spacing: var(--fs-eyebrow-tracking); text-transform: uppercase;
      text-align: start; border-bottom: var(--fs-hairline);
    }` },

  { id: '02-nesting', sel: SEC('Network'), css: `
    .network-status-table .ifacebox { border: 0; background: transparent; padding: 0; }
    .network-status-table .ifacebox-body .ifacebadge {
      border: 0; background: transparent; padding: 0;
      border-left: 2px solid var(--fs-border); padding-left: var(--fs-space-2);
    }` },

  { id: '03-row-action', sel: SEC('DHCP Leases'), css: `
    #view .table[id] .td .cbi-button-apply {
      background: transparent; border-color: transparent; color: var(--fs-dim);
      box-shadow: none;
    }
    #view .table[id] .tr:hover .td .cbi-button-apply,
    #view .table[id] .td .cbi-button-apply:focus-visible {
      color: var(--fs-accent); border-color: var(--fs-border);
    }` },

  { id: '04-zone-red', sel: SEC('Port status'), css: `
    body[data-page="admin-status-overview"] .ifacebox:has(img[src*="/port_"]) > .ifacebox-head:nth-child(3) {
      height: 2px; overflow: hidden; opacity: .45;
    }
    body[data-page="admin-status-overview"] .ifacebox:has(img[src*="/port_"]) > .ifacebox-head:nth-child(3) .zonebadge {
      filter: saturate(.35);
    }` },

  { id: '05-triple-title', sel: SEC('DHCP Leases'), css: `
    #view .cbi-section h3[data-ab-sub] {
      font-size: var(--fs-type-xs); font-weight: var(--fs-eyebrow-weight);
      letter-spacing: var(--fs-eyebrow-tracking); text-transform: uppercase;
      color: var(--fs-faint); margin-bottom: var(--fs-space-1);
    }` },

  { id: '06-two-grammars', sel: SEC('Network'), css: `
    .network-status-table .ifacebox-body > span { display: block; }
    .network-status-table .ifacebox-body > span strong {
      display: inline-block; min-width: 132px; color: var(--fs-dim);
      font-weight: var(--fs-weight);
    }
    .network-status-table .ifacebox-body .ifacebadge > span strong { min-width: 108px; }` },

];

const b = await chromium.launch();
/* Every exit path goes through finally: a throw between the launch and the last shot would
 * otherwise leave chromium running against the stand, where the next probe measures its poll. */
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await login(p, base);
  await p.goto(base + '/cgi-bin/luci/admin/status/overview', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(7000);
  await p.evaluate(() => { try { L.Poll.stop(); } catch (e) {} });
  await p.waitForTimeout(500);
  console.log('sections:', JSON.stringify(await p.evaluate(STAMP)));

  const put = (css) => p.evaluate((c) => {
    let s = document.getElementById('fs-ab');
    if (!s) { s = document.createElement('style'); s.id = 'fs-ab'; document.head.appendChild(s); }
    s.textContent = c;
  }, css);
  const clear = () => p.evaluate(() => document.getElementById('fs-ab')?.remove());

  for (const c of CASES) {
    if (!want(c.id)) continue;
    const loc = p.locator(c.sel).first();
    if (!await loc.count()) { console.log(`SKIP ${c.id} — no ${c.sel}`); continue; }
    await clear(); await p.waitForTimeout(250);
    await loc.screenshot({ path: `${OUT}/${c.id}-before.png` });
    await put(c.css); await p.waitForTimeout(400);
    await loc.screenshot({ path: `${OUT}/${c.id}-after.png` });
    console.log(`ok ${c.id}`);
  }
  await clear();

  /* 07 — the pop shadow, on a real modal */
  if (want('07-shadow-pop')) {
    await p.evaluate(() => L.ui.showModal('Delete lease', [
      E('p', {}, 'The lease for nb-ivan (10.11.12.144) will be released.'),
      E('div', { class: 'right' }, [
        E('button', { class: 'btn cbi-button' }, 'Cancel'),
        E('button', { class: 'btn cbi-button cbi-button-negative' }, 'Delete'),
      ]),
    ]));
    await p.waitForTimeout(600);
    /* the shadow spreads 34px, so the clip is the modal's own box plus 70px of scrim on every side */
    const mb = await p.evaluate(() => { const r = document.querySelector('.modal').getBoundingClientRect();
      return { x: Math.max(0, r.x - 70), y: Math.max(0, r.y - 70), width: r.width + 140, height: r.height + 140 }; });
    await p.screenshot({ path: `${OUT}/07-shadow-pop-before.png`, clip: mb });
    await put(`.modal { box-shadow: 0 1px 2px rgba(0,0,0,.06); border: var(--fs-hairline); }`);
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/07-shadow-pop-after.png`, clip: mb });
    await p.evaluate(() => L.ui.hideModal());
    await clear();
    console.log('ok 07-shadow-pop');
  }

  /* 08 — the frosted bar over scrolled content */
  if (want('08-blur-bar')) {
    await p.evaluate(() => window.scrollTo(0, 900));
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/08-blur-bar-before.png`, clip: { x: 0, y: 0, width: 1440, height: 150 } });
    await put(`:root { --fs-blur: none; } .fs-sidebar, .fs-topbar, [class*="fs-bar"] { background: var(--fs-panel) !important; }`);
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/08-blur-bar-after.png`, clip: { x: 0, y: 0, width: 1440, height: 150 } });
    await clear();
    await p.evaluate(() => window.scrollTo(0, 0));
    console.log('ok 08-blur-bar');
  }

  /* 10 — Compact density: 10px x .9 = 9px on the port figures */
  if (want('10-compact-9px')) {
    await p.evaluate(() => document.documentElement.setAttribute('data-density', 'compact'));
    await p.waitForTimeout(600);
    const loc = p.locator(SEC('Port status')).first();
    await loc.screenshot({ path: `${OUT}/10-compact-9px-before.png` });
    await put(`:root { --fs-type-2xs: max(calc(10px * var(--fs-density-type)), 11px); }`);
    await p.waitForTimeout(400);
    await loc.screenshot({ path: `${OUT}/10-compact-9px-after.png` });
    await p.evaluate(() => document.documentElement.removeAttribute('data-density'));
    await clear();
    console.log('ok 10-compact-9px');
  }
} finally { await b.close(); }
