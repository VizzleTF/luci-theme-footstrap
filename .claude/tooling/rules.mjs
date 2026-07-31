/* Ask the engine which rules actually match the offending button, in the broken state and in the
 * fresh one. CDP answers with the stylesheet and the line, so the file is named rather than guessed. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const PATH = 'admin/network/firewall/zones';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
const cdp = await p.context().newCDPSession(p);
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
await login(p, BASE);
const settle = async () => { await p.waitForTimeout(400); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await p.waitForTimeout(500); };

async function dig(label) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId,
    selector: '.table.cbi-section-table .tr:not(.cbi-section-table-titles) .td.cbi-section-actions' });
  if (!nodeId) return { label, err: 'cell not found' };
  const cell = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
  const { nodeId: btnId } = await cdp.send('DOM.querySelector', { nodeId, selector: 'button.cbi-button-edit' });
  const btn = btnId ? await cdp.send('CSS.getMatchedStylesForNode', { nodeId: btnId }) : null;
  const fmt = (m) => (m?.matchedCSSRules || [])
    .filter((r) => /width|flex|white-space/.test(r.rule.style.cssText || ''))
    .map((r) => ({
      sel: r.rule.selectorList.text.slice(0, 78),
      media: (r.rule.media || []).map((x) => x.text).join(' && ') || null,
      decl: (r.rule.style.cssProperties || []).filter((c) => /width|flex|white-space/.test(c.name))
              .map((c) => c.name + ':' + c.value).join('; ')
    }));
  return { label, cell: fmt(cell), button: fmt(btn),
    inline: (cell.inlineStyle?.cssText || '') + ' | btn: ' + (btn?.inlineStyle?.cssText || '') };
}

await p.setViewportSize({ width: 1000, height: 900 });
await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
await p.setViewportSize({ width: 1280, height: 900 }); await settle();
const broken = await dig('BROKEN (1000 -> 1280)');
await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
const fresh = await dig('FRESH @1280');
console.log(JSON.stringify([broken, fresh], null, 1));
await b.close();
