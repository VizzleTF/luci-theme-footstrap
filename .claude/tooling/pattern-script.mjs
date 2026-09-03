/* Does the pattern set-pattern.sh installed actually PAINT — pre-login and after login, in a
 * browser that has made no choice of its own (a fresh context has empty localStorage, so the
 * router's saved default is what is under test). node .claude/tooling/pattern-script.mjs <router> */
import { chromium } from 'playwright';
import { PORTS, login } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const base = 'http://localhost:' + PORTS[router];

const READ = `(() => {
  const de = document.documentElement;
  const layer = document.querySelector('.fs-pattern');
  const cs = layer ? getComputedStyle(layer) : null;
  return {
    wallpaperAttr: de.getAttribute('data-wallpaper'),
    inkAttr: de.getAttribute('data-pattern-ink'),
    url: getComputedStyle(de).getPropertyValue('--fs-pattern-url').trim(),
    size: getComputedStyle(de).getPropertyValue('--fs-pattern-size').trim(),
    strength: getComputedStyle(de).getPropertyValue('--fs-pattern-strength').trim(),
    layer: !!layer,
    maskImage: cs ? (cs.maskImage || cs.webkitMaskImage) : null,
    bgImage: cs ? cs.backgroundImage : null,
    maskSize: cs ? (cs.maskSize || cs.webkitMaskSize) : null,
    opacity: cs ? cs.opacity : null,
    rect: layer ? Math.round(layer.getBoundingClientRect().width) + 'x' + Math.round(layer.getBoundingClientRect().height) : null
  };
})()`;

const browser = await chromium.launch();
/* finally, for the same reason as the other probes: a throw would leave chromium on the stand. */
try {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const bad = [];
  p.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') bad.push('console: ' + m.text()); });

  await p.goto(base + '/cgi-bin/luci/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  console.log(router, 'login page ', JSON.stringify(await p.evaluate(READ)));

  await login(p, base);
  console.log(router, 'after login', JSON.stringify(await p.evaluate(READ)));

  /* the tile must actually be fetchable at the URL the theme built, token and all */
  const url = (await p.evaluate(READ)).url.replace(/^url\(["']?|["']?\)$/g, '');
  if (url && url !== 'none') {
    const r = await p.request.get(base + url);
    console.log(router, 'GET', url, '->', r.status(), r.headers()['content-type'], (await r.body()).length, 'bytes');
  }
  console.log(router, bad.length ? 'ERRORS: ' + bad.join(' | ') : 'no page errors');
} finally { await browser.close(); }
