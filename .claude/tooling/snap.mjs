/* Two heap snapshots, N navigations apart, aggregated by object name — what grew is what leaks. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const WARM = 70, SPAN = Number(process.argv[3] || 280);
const RING = ['admin/network/firewall/zones', 'admin/network/firewall/forwards',
              'admin/network/firewall/rules', 'admin/network/dhcp', 'admin/network/wireless',
              'admin/status/processes', 'admin/system/system'];

const b = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const cdp = await p.context().newCDPSession(p);
await cdp.send('HeapProfiler.enable');
await login(p, BASE);
await p.evaluate(() => document.querySelectorAll('#topmenu > li.has-sub:not(.open) > a').forEach((a) => a.click()));
await p.waitForTimeout(600);

async function snapshot() {
  await cdp.send('HeapProfiler.collectGarbage'); await p.waitForTimeout(500);
  let buf = '';
  const on = (e) => { buf += e.chunk; };
  cdp.on('HeapProfiler.addHeapSnapshotChunk', on);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', on);
  const j = JSON.parse(buf);
  const fields = j.snapshot.meta.node_fields;
  const NF = fields.length, iName = fields.indexOf('name'), iSize = fields.indexOf('self_size'), iType = fields.indexOf('type');
  const types = j.snapshot.meta.node_types[0];
  const agg = new Map();
  for (let i = 0; i < j.nodes.length; i += NF) {
    const name = j.strings[j.nodes[i + iName]] || '(anon)';
    const key = types[j.nodes[i + iType]] + ' ' + name;
    const a = agg.get(key) || { n: 0, bytes: 0 };
    a.n++; a.bytes += j.nodes[i + iSize];
    agg.set(key, a);
  }
  return agg;
}
async function hop(i) {
  await p.evaluate((h) => document.querySelector(`a[href="${h}"]`)?.click(), '/cgi-bin/luci/' + RING[i % RING.length]);
  await p.waitForTimeout(850);
}
for (let i = 0; i < WARM; i++) await hop(i);
const a = await snapshot();
for (let i = WARM; i < WARM + SPAN; i++) { await hop(i); if (i % 50 === 0) process.stderr.write('.'); }
const c = await snapshot();
process.stderr.write('\n');

const rows = [];
for (const [k, v] of c) {
  const o = a.get(k) || { n: 0, bytes: 0 };
  const dn = v.n - o.n, db = v.bytes - o.bytes;
  if (db > 20000 || dn > 200) rows.push({ k, dn, dbKB: Math.round(db / 1024), nowN: v.n, nowKB: Math.round(v.bytes / 1024) });
}
rows.sort((x, y) => y.dbKB - x.dbKB);
console.log(JSON.stringify({ span: SPAN, top: rows.slice(0, 22) }, null, 1));
await b.close();
