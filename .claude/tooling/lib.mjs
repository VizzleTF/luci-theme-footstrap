/* Shared rig for the stand probes: log in and measure the chrome the same way everywhere so
 * results from different probes compare. */
import { login as standsLogin } from '../../tools/lib/stands.mjs';

/* Host http ports; stands() lists only running openwrt stands, so imm* stay here. imm2512/imm2410
 * are on-demand, not in owlab.yaml by default (docs/development.md, "ImmortalWrt stands (on
 * demand)") — these ports are only live once that note's blocks are booted. */
export const PORTS = { owrt2512: 8025, owrt2410: 8024, imm2512: 8026, imm2410: 8027, owrtsnap: 8022 };

export async function login(p, base) {
  await standsLogin(p, base + '/cgi-bin/luci');
  /* stands.mjs's own login has no equivalent wait; the probes read the page right after this
   * returns, before LuCI's post-login redirect has settled. */
  await p.waitForTimeout(2500);
}

/* One snapshot of "is the chrome still the chrome": the numbers a foreign sheet flattens first. */
export const SNAP = `(() => {
  const cs = (el, p) => el ? getComputedStyle(el)[p] : null;
  const bar = document.querySelector('.fs-sidebar');
  const de = document.documentElement;
  const sheets = { styles: 0, links: 0, shims: 0, disabledLinks: 0, layered: 0 };
  for (const el of document.querySelectorAll('style, link[rel~="stylesheet"]')) {
    if (el.tagName === 'LINK') { sheets.links++; if (el.disabled) sheets.disabledLinks++; }
    else { sheets.styles++; if ((el.textContent || '').startsWith('@import')) sheets.shims++; }
    if (el.dataset && el.dataset.fsLayered === '1') sheets.layered++;
  }
  return {
    dataPage: document.body.getAttribute('data-page'),
    sidebarPad: cs(bar, 'padding'),
    sidebarW: bar ? Math.round(bar.getBoundingClientRect().width) : null,
    menuItems: document.querySelectorAll('#topmenu > li').length,
    brandVisible: !!document.querySelector('.fs-brand')?.getClientRects().length,
    hOverflow: de.scrollWidth - de.clientWidth,
    viewChildren: document.getElementById('view')?.children.length ?? null,
    sheets,
    intervals: window.__fsViewIntervals ? window.__fsViewIntervals.size : null,
    pollQueue: (window.L && L.Poll && L.Poll.queue) ? L.Poll.queue.length : null
  };
})()`;
