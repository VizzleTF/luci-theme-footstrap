/* Does dragging Wallpaper -> Dim ALONE light the "Save as default" button?
 *
 * Isolation matters: switching the Wallpaper seg to File is itself a diverging change, so it lights
 * the button on its own and would mask the axis under test. Save that state as the router default
 * first — the button greys, meaning "this browser matches" — and then the Dim drag is the only
 * thing that can move it. */
import { chromium } from 'playwright';

const BASE = 'http://localhost:8025';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });

await p.goto(BASE + '/cgi-bin/luci/', { waitUntil: 'domcontentloaded' });
if (await p.locator('input[name="luci_password"]').count()) {
  await p.fill('input[name="luci_username"]', 'root');
  await p.fill('input[name="luci_password"]', '');
  await Promise.all([ p.waitForNavigation({ waitUntil: 'domcontentloaded' }), p.click('input[type=submit]') ]);
}
await p.waitForTimeout(2500);

const saveBtn = () => p.evaluate(() => {
  const s = [...document.querySelectorAll('.fs-appearance-pop button')].find((x) => /^Saved? as default$/.test(x.textContent.trim()));
  return s ? { text: s.textContent.trim(), disabled: s.disabled } : null;
});
const openPop = async () => { await p.click('#fs-appearance'); await p.waitForTimeout(400); };

await openPop();
/* baseline: wallpaper=file, saved router-wide, so this browser matches the default exactly */
await p.evaluate(() => [...document.querySelectorAll('.fs-ap-wall .fs-seg button')].find((b) => b.dataset.val === 'file').click());
await p.waitForTimeout(200);
/* tolerate an already-matching baseline: a previous run may have saved this very state, in which
 * case the button is already greyed and there is nothing to press */
await p.evaluate(() => {
  const s = [...document.querySelectorAll('.fs-appearance-pop button')].find((x) => /^Save as default$/.test(x.textContent.trim()));
  if (s) s.click();
});
await p.waitForTimeout(2500);
const baseline = await saveBtn();

/* the axis under test, on its own */
const dim = await p.evaluate(() => {
  const r = document.querySelector('.fs-ap-bg input[type=range]');
  if (!r) return null;
  const was = r.value;
  r.value = String(Number(r.value) === 20 ? 40 : 20);
  r.dispatchEvent(new Event('input', { bubbles: true }));
  return { from: was, to: r.value, stored: localStorage.getItem('fs-photo-dim') };
});
await p.waitForTimeout(300);
const afterDim = await saveBtn();

const ok = baseline && baseline.disabled === true && afterDim && afterDim.disabled === false;
console.log(JSON.stringify({
  baseline_savedSoButtonGreys: baseline,
  dimSlider: dim,
  afterDimDragAlone: afterDim,
  verdict: ok ? 'PASS — Dim alone lights Save' : 'FAIL — Dim did not refresh the button'
}, null, 2));
await b.close();
process.exit(ok ? 0 : 1);
