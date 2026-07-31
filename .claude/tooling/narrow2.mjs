/* The 768 -> 800 crossing: data-narrow clears, the sidebar comes back and the content column SHRINKS
 * from 712 to 520 while the viewport grows. Anything laid out for 712 that cannot re-fit shows here. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;

const M = `(() => {
  const main = document.getElementById('maincontent');
  const c = document.querySelector('.fs-content'); const cs = getComputedStyle(c);
  const box = c.getBoundingClientRect(); const right = box.right - parseFloat(cs.paddingRight);
  const out = [];
  for (const el of c.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'fixed') continue;
    if (el.closest('.ace_editor, .cbi-tooltip, [aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    const past = Math.round(r.right - right);
    if (past > 1) out.push({ past, w: Math.round(r.width),
      sel: el.nodeName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0,3).join('.') : ''),
      inline: el.getAttribute('style') || '', ws: s.whiteSpace, text: (el.textContent||'').trim().slice(0,40) });
  }
  out.sort((a,b)=>b.past-a.past);
  return { colW: Math.round(box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
    narrow: document.documentElement.hasAttribute('data-narrow'),
    ovf: main.scrollWidth - main.clientWidth, top: out.slice(0,3) };
})()`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await login(p, BASE);
const settle = async () => { await p.waitForTimeout(500); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await p.waitForTimeout(700); };
for (const path of ['admin/network/firewall/zones', 'admin/network/wireless']) {
  for (const [from, to] of [[768, 800], [700, 800], [768, 900], [600, 800], [1280, 800]]) {
    await p.setViewportSize({ width: from, height: 900 });
    await p.goto(BASE + '/cgi-bin/luci/' + path, { waitUntil: 'domcontentloaded' }).catch(()=>{});
    await p.waitForTimeout(3000);
    await p.setViewportSize({ width: to, height: 900 });
    await settle();
    const m = await p.evaluate(M);
    console.log(path.split('/').pop().padEnd(9), (from + '->' + to).padEnd(11), 'colW=' + String(m.colW).padEnd(5),
      'ovf=' + String(m.ovf).padEnd(5), m.top[0] ? `${m.top[0].sel} +${m.top[0].past} w=${m.top[0].w} ws=${m.top[0].ws} inline=${JSON.stringify(m.top[0].inline.slice(0,50))}` : 'clean');
  }
}
await b.close();
