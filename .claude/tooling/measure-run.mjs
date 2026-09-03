/* What a session's main thread carried: tool-result characters per tool, images, Agent calls,
 * text written. The number the crew is judged on (docs/crew.md "Measuring the crew").
 *
 *   node .claude/tooling/measure-run.mjs            # the newest transcript of this project
 *   node .claude/tooling/measure-run.mjs latest 3   # the three newest
 *   node .claude/tooling/measure-run.mjs <path.jsonl>
 *
 * A transcript is one JSON object per line; a tool_result is matched to its tool_use by id, so the
 * per-tool split is exact rather than guessed from the content.
 *
 * Since 2.1.x a subagent writes its own transcript under <session>/subagents/, so the file above
 * holds the lead alone and its number would show only that the lead got lighter. The `delegated`
 * line is the other half of that trade: what the roles spent to make it so. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const slug = '-' + process.cwd().replace(/^\//, '').replace(/[/.]/g, '-');
const dir = join(homedir(), '.claude', 'projects', slug);

function newest(n) {
  if (!existsSync(dir)) {
    console.error(`no transcripts for this project: ${dir}`);
    process.exit(2);
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, n)
    .map((x) => x.f);
}

function measure(file) {
  const byTool = new Map();
  const uses = new Map();
  let images = 0, imageBytes = 0, text = 0, agents = 0, results = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const c = o.message && o.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === 'text') text += (b.text || '').length;
      else if (b.type === 'tool_use') {
        uses.set(b.id, b.name);
        if (b.name === 'Agent' || b.name === 'Task') agents += 1;
      } else if (b.type === 'tool_result') {
        results += 1;
        const name = uses.get(b.tool_use_id) || '?';
        const cc = b.content;
        const s = typeof cc === 'string' ? cc : JSON.stringify(cc);
        if (Array.isArray(cc) && cc.some((x) => x.type === 'image')) { images += 1; imageBytes += s.length; continue; }
        const cur = byTool.get(name) || { chars: 0, n: 0 };
        cur.chars += s.length; cur.n += 1;
        byTool.set(name, cur);
      }
    }
  }
  const total = [...byTool.values()].reduce((a, v) => a + v.chars, 0);
  return { file, total, byTool, images, imageBytes, text, agents, results };
}

/* Every subagent this session spawned, from <session>/subagents/agent-*.jsonl beside the file. */
function delegated(file) {
  const sub = file.replace(/\.jsonl$/, '') + '/subagents';
  if (!existsSync(sub)) return { agents: 0, chars: 0 };
  let agents = 0, chars = 0;
  for (const f of readdirSync(sub).filter((x) => x.endsWith('.jsonl'))) {
    agents += 1;
    chars += measure(join(sub, f)).total;
  }
  return { agents, chars };
}

const arg = process.argv[2] || 'latest';
const files = arg.endsWith('.jsonl') ? [arg] : newest(Number(process.argv[3] || 1));
for (const f of files) {
  const m = measure(f);
  console.log(`${f}`);
  console.log(`  tool-result chars (main thread): ${m.total}   images: ${m.images} (${m.imageBytes} B)   text: ${m.text}   Agent calls: ${m.agents}   results: ${m.results}`);
  const d = delegated(f);
  console.log(`  delegated: ${d.agents} subagent transcript(s), ${d.chars} tool-result chars — read by the role, not by the lead`);
  for (const [name, v] of [...m.byTool.entries()].sort((a, b) => b[1].chars - a[1].chars)) {
    console.log(`    ${name.padEnd(16)} ${String(v.chars).padStart(9)}  n=${v.n}`);
  }
}
