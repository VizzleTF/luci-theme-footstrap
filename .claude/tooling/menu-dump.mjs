import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const b = await chromium.launch(); const p = await b.newPage();
await login(p, BASE);
console.log(JSON.stringify(await p.evaluate(() => window.L.require('ui').then((ui) => ui.menu.load()).then((tree) => {
  const out = [];
  const walk = (node, segs) => {
    const kids = node.children || {};
    for (const name in kids) {
      const c = kids[name]; const s = segs.concat([name]);
      out.push({ p: s.join('/'), t: c.action?.type ?? '(none)', sat: c.satisfied !== false, title: !!c.title, css: c.css || null });
      if (s.length < 4) walk(c, s);
    }
  };
  walk(tree, []);
  return out.filter((x) => /clash|podkop|banip|adblock|filemanager/.test(x.p));
})), null, 1));
await b.close();
