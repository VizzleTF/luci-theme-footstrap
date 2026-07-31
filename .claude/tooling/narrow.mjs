/* The second overflow shape, checked on FRESH loads so a resize artefact cannot be mistaken for it:
 * around 800-900px the sidebar is still a sidebar (the content column has not dropped below
 * --fs-content-min) but the config table has carded, and something inside a card does not fit. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;

const M = `(() => {
  const main = document.getElementById('maincontent');
  const c = document.querySelector('.fs-content'); const cs = getComputedStyle(c);
  const box = c.getBoundingClientRect();
  const rightEdge = box.right - parseFloat(cs.paddingRight);
  const out = [];
  for (const el of c.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'fixed') continue;
    if (el.closest('.ace_editor, .cbi-tooltip, [aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    const past = Math.round(r.right - rightEdge);
    if (past > 1) out.push({ past, w: Math.round(r.width), min: el.scrollWidth,
      sel: el.nodeName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0,3).join('.') : ''),
      ws: s.whiteSpace, title: el.getAttribute('data-title'), text: (el.textContent||'').trim().slice(0,44) });
  }
  out.sort((a,b)=>b.past-a.past);
  return { colW: Math.round(box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
    narrow: document.documentElement.hasAttribute('data-narrow'),
    mainOverflow: main.scrollWidth - main.clientWidth, top: out.slice(0,4) };
})()`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await login(p, BASE);
for (const path of ['admin/network/firewall/zones', 'admin/network/dhcp', 'admin/network/wireless']) {
  for (const w of [700, 768, 800, 850, 900, 960, 1000]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.goto(BASE + '/cgi-bin/luci/' + path, { waitUntil: 'domcontentloaded' }).catch(()=>{});
    await p.waitForTimeout(3000);
    const m = await p.evaluate(M);
    console.log(path.split('/').pop().padEnd(10), String(w).padEnd(6), 'colW=' + String(m.colW).padEnd(5),
      'narrow=' + String(m.narrow).padEnd(6), 'ovf=' + String(m.mainOverflow).padEnd(5),
      m.top[0] ? `${m.top[0].sel} +${m.top[0].past} (w=${m.top[0].w}, ws=${m.top[0].ws}) ${JSON.stringify(m.top[0].text)}` : '');
  }
}
await b.close();
