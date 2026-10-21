/* What a session's main thread carried: tool-result characters per tool, images, Agent calls,
 * text written. The number the crew is judged on (docs/crew.md "Measuring the crew").
 *
 *   node .claude/tooling/measure-run.mjs            # the newest transcript of this project
 *   node .claude/tooling/measure-run.mjs latest 3   # the three newest
 *   node .claude/tooling/measure-run.mjs <path.jsonl | session-id>
 *
 * A transcript is one JSON object per line; a tool_result is matched to its tool_use by id, so the
 * per-tool split is exact rather than guessed from the content.
 *
 * Since 2.1.x a subagent writes its own transcript under <session>/subagents/, so the file above
 * holds the lead alone and its number would show only that the lead got lighter. The `delegated`
 * line is the other half of that trade: what the roles spent to make it so.
 *
 * After the character lines come the lead's characters per delegation against the 15k budget, its
 * five largest tool outputs, and a token table per role and model. A message split over several
 * transcript lines repeats its usage (252 of 397 ids in one lead transcript), so a message counts
 * once by `message.id`. input, cache_read and cache_creation arrive with the first line and are exact;
 * output_tokens is final only on a line with a stop_reason, and a subagent transcript mostly keeps
 * just the stream-start line (55 of 1407 direct-subagent ids and 134 of 3055 workflow ids have a final
 * one, the lead 409 of 409), so a row with such a message prints output as `>=N (final/msgs final)`.
 * The cost question is cache_read: one session read 175M of it in workflow agents against 124M in the lead. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';

const BUDGET = 15000; // lead tool output per card, docs/crew.md "Measuring the crew"
const SUM = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];

const slug = process.cwd().replace(/[^A-Za-z0-9]/g, '-');
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
  const msgs = new Map();
  const top = [];
  let images = 0, imageBytes = 0, text = 0, agents = 0, results = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const m = o.message;
    if (m && m.role === 'assistant' && m.id && m.usage) {
      const prev = msgs.get(m.id);
      // a final line (stop_reason set) is never replaced by a later stream-start one; else the last line wins
      if (!(prev && prev.final && m.stop_reason == null)) msgs.set(m.id, { model: m.model, usage: m.usage, final: m.stop_reason != null });
    }
    const c = m && m.content;
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
        top.push({ name, chars: s.length, ts: o.timestamp });
        top.sort((a, b) => b.chars - a.chars);
        if (top.length > 5) top.pop();
      }
    }
  }
  const total = [...byTool.values()].reduce((a, v) => a + v.chars, 0);
  return { file, total, byTool, images, imageBytes, text, agents, results, msgs, top };
}

/* Every subagent this session spawned: <session>/subagents/agent-*.jsonl, and the workflow ones one
 * level down in subagents/workflows/<id>/ (1728 of them in one session, none counted by a flat read);
 * a workflow's journal.jsonl beside them is its event log, not a transcript. */
function jsonls(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? jsonls(join(dir, e.name)) : /^agent-.*\.jsonl$/.test(e.name) ? [join(dir, e.name)] : []);
}

/* The role is the agentType in the .meta.json beside the transcript; a workflow agent can carry the same
 * type as a direct one (tester, developer), so its row is told apart by the workflows/ directory. */
function roleOf(sub, f) {
  let type = '?';
  try { type = JSON.parse(readFileSync(f.replace(/\.jsonl$/, '.meta.json'), 'utf8')).agentType || '?'; } catch { /* no meta */ }
  return relative(sub, f).startsWith('workflows') ? `${type} (workflow)` : type;
}

function delegated(file) {
  const sub = file.replace(/\.jsonl$/, '') + '/subagents';
  if (!existsSync(sub)) return { agents: 0, chars: 0, subs: [] };
  let agents = 0, chars = 0;
  const subs = [];
  for (const f of jsonls(sub)) {
    agents += 1;
    const m = measure(f);
    chars += m.total;
    subs.push({ role: roleOf(sub, f), msgs: m.msgs });
  }
  return { agents, chars, subs };
}

/* Rows per role and model; an id seen in an earlier transcript is skipped, so no message counts twice.
 * `final` counts the messages whose output_tokens is the total, not the stream-start snapshot. */
function tokenRows(parts) {
  const rows = new Map(), seen = new Set();
  for (const { role, msgs } of parts) {
    for (const [id, { model, usage, final }] of msgs) {
      if (seen.has(id)) continue;
      seen.add(id);
      const key = `${role}\0${model || '?'}`;
      const r = rows.get(key) || { role, model: model || '?', msgs: 0, final: 0, ...Object.fromEntries(SUM.map((k) => [k, 0])) };
      r.msgs += 1;
      if (final) r.final += 1;
      for (const k of SUM) r[k] += usage[k] || 0;
      rows.set(key, r);
    }
  }
  return [...rows.values()].sort((a, b) => b.cache_read_input_tokens - a.cache_read_input_tokens || (a.role + a.model).localeCompare(b.role + b.model));
}

const W = [8, 12, 30, 14, 16]; // msgs, then the SUM columns; the widest cells are the output bound and cache_creation
const row = (role, model, ...v) => `    ${role.padEnd(30)} ${model.padEnd(20)}${v.map((n, i) => String(n).padStart(W[i])).join('')}`;
const outCell = (r) => (r.final < r.msgs ? `>=${r.output_tokens} (${r.final}/${r.msgs} final)` : r.output_tokens);
const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);

const arg = process.argv[2] || 'latest';
const files = arg.endsWith('.jsonl') ? [arg] : /^[0-9a-f-]{36}$/.test(arg) ? [join(dir, arg + '.jsonl')] : newest(Number(process.argv[3] || 1));
for (const f of files) {
  const m = measure(f);
  console.log(`${f}`);
  console.log(`  tool-result chars (main thread): ${m.total}   images: ${m.images} (${m.imageBytes} B)   text: ${m.text}   Agent calls: ${m.agents}   results: ${m.results}`);
  const d = delegated(f);
  console.log(`  delegated: ${d.agents} subagent transcript(s), ${d.chars} tool-result chars — read by the role, not by the lead`);
  for (const [name, v] of [...m.byTool.entries()].sort((a, b) => b[1].chars - a[1].chars)) {
    console.log(`    ${name.padEnd(16)} ${String(v.chars).padStart(9)}  n=${v.n}`);
  }
  console.log(m.agents
    ? `  lead per delegation: ${Math.round(m.total / m.agents)} chars over ${m.agents} Agent call(s), budget ${BUDGET}: ${m.total / m.agents > BUDGET ? 'OVER' : 'within'}`
    : `  lead per delegation: n/a, no Agent calls (${m.total} chars, budget ${BUDGET})`);
  console.log('  largest lead tool outputs:');
  for (const t of m.top) console.log(`    ${t.name.padEnd(16)} ${String(t.chars).padStart(9)}  ${t.ts || '?'}`);
  const rows = tokenRows([{ role: 'lead', msgs: m.msgs }, ...d.subs]);
  console.log('  tokens, each assistant message once by message.id:');
  console.log(row('role', 'model', 'msgs', 'input', 'output', 'cache_read', 'cache_creation'));
  for (const r of [...rows, { role: 'total', model: '', ...Object.fromEntries(['msgs', 'final', ...SUM].map((k) => [k, sum(rows, k)])) }]) {
    console.log(row(r.role, r.model, r.msgs, r.input_tokens, outCell(r), r.cache_read_input_tokens, r.cache_creation_input_tokens));
  }
}
