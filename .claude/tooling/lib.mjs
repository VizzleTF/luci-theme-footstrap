/* Shared rig for the stand probes: log in, enumerate every page the dispatcher can render, and
 * measure the chrome the same way everywhere so results from different probes compare. */
export const PORTS = { owrt2512: 8025, owrt2410: 8024, imm2512: 8026, imm2410: 8027 };

export async function login(p, base) {
  await p.goto(base + '/cgi-bin/luci/', { waitUntil: 'domcontentloaded' });
  if (await p.locator('input[name="luci_password"]').count()) {
    await p.fill('input[name="luci_username"]', 'root');
    await p.fill('input[name="luci_password"]', '');
    await Promise.all([ p.waitForNavigation({ waitUntil: 'domcontentloaded' }), p.click('input[type=submit]') ]);
  }
  await p.waitForTimeout(2500);
}

/* Every leaf the theme's router would treat as SPA-able, straight out of LuCI's own menu tree —
 * the same ACL-filtered blob the chrome uses, so this cannot list a page the session may not open. */
export const PAGES = `(() => window.L.require('ui').then((ui) => ui.menu.load()).then((tree) => {
  const out = [];
  const walk = (node, segs) => {
    const kids = node.children || {};
    for (const name in kids) {
      const c = kids[name];
      if (!c || !c.satisfied || !c.title) continue;
      const s = segs.concat([name]);
      if (c.action && (c.action.type === 'view' || c.action.type === 'template' || c.action.type === 'cbi'))
        out.push({ path: s.join('/'), type: c.action.type, title: c.title });
      if (s.length < 4) walk(c, s);
    }
  };
  walk(tree, []);
  return out;
}))()`;

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

/* SPA or full load: a sentinel on window dies with the document. */
export async function navAndCheck(p, href, waitMs = 2200) {
  await p.evaluate(() => { window.__fsSentinel = 'alive'; });
  const clicked = await p.evaluate((h) => {
    const a = document.querySelector(`a[href="${h}"]`);
    if (a) { a.click(); return true; }
    return false;
  }, href);
  if (!clicked) { await p.goto(href, { waitUntil: 'domcontentloaded' }); }
  await p.waitForTimeout(waitMs);
  return { clicked, spa: await p.evaluate(() => window.__fsSentinel === 'alive') };
}
