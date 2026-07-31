/* The dispatcher computes readonly over the ACCUMULATED acls of the whole resolved path
 * (dispatcher.uc:1003, ctx.acls), while apply_tree_acls() stamps the menu JSON per NODE. So a leaf
 * with no depends.acl of its own inherits the verdict from an ancestor that has one. Check the
 * chains of the six nodes where the SPA arrival disagreed with the full load. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const b = await chromium.launch();
const p = await b.newPage();
await login(p, BASE);

const PATHS = ['admin/status/logs/syslog', 'admin/status/realtime/load', 'admin/status/processes',
               'admin/dashboard', 'admin/system/system', 'admin/network/firewall/zones'];
const res = await p.evaluate(async (paths) => {
  const ui = await L.require('ui');
  const tree = await ui.menu.load();
  const out = {};
  for (const path of paths) {
    let node = tree;
    const chain = [];
    for (const s of path.split('/')) {
      node = node && node.children && node.children[s];
      if (!node) break;
      chain.push({ s, ro: node.readonly === true, acl: node.depends?.acl || null, sat: node.satisfied });
    }
    out[path] = { chain, anyRo: chain.some((c) => c.ro) };
  }
  return out;
}, PATHS);
console.log(JSON.stringify(res, null, 1));
await b.close();
