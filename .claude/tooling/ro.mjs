/* Where does readonly go? Dump what the CLIENT menu tree says about the six nodes whose
 * nodespec.readonly a full load sets and an SPA arrival does not. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const BASE = `http://localhost:${PORTS[router]}`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await login(p, BASE);

const PATHS = ['admin/status/logs/syslog', 'admin/status/realtime/load', 'admin/status/processes'];
const res = await p.evaluate(async (paths) => {
  const ui = await L.require('ui');
  const tree = await ui.menu.load();
  const out = {};
  for (const path of paths) {
    let node = tree;
    for (const s of path.split('/')) node = node && node.children && node.children[s];
    out[path] = node ? { keys: Object.keys(node), readonly: node.readonly, action: node.action,
                         write: node.write, depends: node.depends } : null;
  }
  /* and what the server stamped for the page we are standing on */
  out.__env = { path: location.pathname, nodespec: L.env.nodespec };
  return out;
}, PATHS);

/* now a real full load of one of them, to see the server's own nodespec */
await p.goto(BASE + '/cgi-bin/luci/' + PATHS[0], { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
res.__full = await p.evaluate(() => ({ nodespec: L.env.nodespec,
  perm: (typeof L.hasViewPermission === 'function') ? L.hasViewPermission() : null,
  disabledBtns: document.querySelectorAll('#view button[disabled], #view .cbi-button[disabled]').length,
  btns: document.querySelectorAll('#view button, #view .cbi-button').length }));

console.log(JSON.stringify(res, null, 1));
await b.close();
