/* Recon for the design A/B shots: what the Overview actually renders on the stand, and where. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { login, PORTS } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const base = `http://localhost:${PORTS[router]}`;
const OUT = fileURLToPath(new URL('../../../tmp/design-ab', import.meta.url));
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await login(p, base);
  await p.goto(base + '/cgi-bin/luci/admin/status/overview', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);

  const dump = await p.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const secs = [...document.querySelectorAll('#view .cbi-section')].map((s, i) => ({
      i, h3: s.querySelector('h3')?.textContent?.trim() || null, ...r(s),
      hasTable: !!s.querySelector('table.table'), hasIfacebox: !!s.querySelector('.ifacebox'),
      hasPort: !!s.querySelector('.ifacebox img[src*="/port_"]'), hasNst: !!s.querySelector('.network-status-table'),
      hasProgress: !!s.querySelector('.cbi-progressbar'), buttons: s.querySelectorAll('.td button, .td .cbi-button').length,
    }));
    return { secs, docH: document.documentElement.scrollHeight, ports: document.querySelectorAll('.ifacebox img[src*="/port_"]').length,
             zonebadges: document.querySelectorAll('.ifacebox .zonebadge').length,
             assoc: document.querySelectorAll('.assoclist').length };
  });
  console.log(JSON.stringify(dump, null, 1));
  await p.screenshot({ path: `${OUT}/recon-full.png`, fullPage: true });
  /* A throw anywhere above used to leave the browser running: chromium outlives the node process
   * that launched it, and a stand with three orphan browsers on it measures nothing twice. */
} finally { await b.close(); }
