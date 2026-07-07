'use strict';
'require baseclass';
'require rpc';
'require uci';

/* Footstrap dashboard for Status → Overview (design 1A).
 * Additive include (unique filename → no collision with luci-mod-status).
 * Renders the whole curated top: KPI row (Load / Memory / Storage / Uptime) +
 * System + Memory + Storage cards, exactly like the sidebar mock, from the same
 * ubus data the stock includes use. The stock System/Memory/Storage sections
 * (which this duplicates) are hidden at runtime; Ports/Network/DHCP/Wifi stay.
 * Crosses the theme/mod line on purpose — see docs/08 "Границы". */

const callSystemBoard  = rpc.declare({ object: 'system', method: 'board' });
const callSystemInfo   = rpc.declare({ object: 'system', method: 'info' });
const callLuciVersion  = rpc.declare({ object: 'luci',   method: 'getVersion' });
const callGetUnixtime  = rpc.declare({ object: 'luci',   method: 'getUnixtime', expect: { result: 0 } });
const callMountPoints  = rpc.declare({ object: 'luci',   method: 'getMountPoints', expect: { result: [] } });

const SKIP = ['/rom', '/tmp', '/dev', '/overlay', '/'];

function hb(bytes) {
	bytes = Number(bytes) || 0;
	const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
	let i = 0;
	while (bytes >= 1024 && i < u.length - 1) { bytes /= 1024; i++; }
	return { v: bytes, u: u[i] };
}
function fmt(bytes, dec) { const x = hb(bytes); return x.v.toFixed(dec == null ? 2 : dec) + ' ' + x.u; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pct(used, total) { return total ? Math.min(100, Math.round(used / total * 100)) : 0; }

/* meter row: label + "used / total" on top, thin colored bar below */
function meter(label, used, total, color) {
	const p = pct(used, total);
	return `<div class="fs-meter">
		<div class="fs-meter-top"><span>${esc(label)}</span><em>${esc(fmt(used, 1))} / ${esc(fmt(total, 1))}</em></div>
		<div class="fs-bar"><div style="width:${p}%;background:${color}"></div></div>
	</div>`;
}

return baseclass.extend({
	title: _('Overview'),
	loadHistory: [],

	load() {
		return Promise.all([
			L.resolveDefault(callSystemBoard(), {}),
			L.resolveDefault(callSystemInfo(), {}),
			L.resolveDefault(callLuciVersion(), { revision: _('unknown version'), branch: 'LuCI' }),
			L.resolveDefault(callGetUnixtime(), 0),
			L.resolveDefault(callMountPoints(), []),
			uci.load('system')
		]);
	},

	render(data) {
		const board = data[0] || {}, info = data[1] || {}, luci = data[2] || {}, unixtime = data[3] || 0, mounts = data[4] || [];
		const mem = L.isObject(info.memory) ? info.memory : {};
		const total = mem.total || 0, free = mem.free || 0, buffered = mem.buffered || 0, cached = mem.cached || 0;
		const available = mem.available || (free + buffered);
		const used = total ? total - free : 0;
		const memPct = pct(used, total);

		const load = Array.isArray(info.load) ? info.load : [0, 0, 0];
		const l1 = load[0] / 65535, l5 = load[1] / 65535, l15 = load[2] / 65535;
		this.loadHistory.push(l1);
		if (this.loadHistory.length > 32) this.loadHistory.shift();

		const upsec = parseInt(info.uptime) || 0;
		const upd = Math.floor(upsec / 86400),
		      uph = Math.floor((upsec % 86400) / 3600),
		      upm = Math.floor((upsec % 3600) / 60),
		      ups = upsec % 60;

		/* storage: pick the biggest real mount for the KPI tile */
		const root = L.isObject(info.root) ? info.root : {}, tmp = L.isObject(info.tmp) ? info.tmp : {};
		const realMounts = (Array.isArray(mounts) ? mounts : []).filter(m => !SKIP.includes(m.mount));
		let big = null;
		realMounts.forEach(m => { if (!big || m.size > big.size) big = m; });
		const stUsed = big ? (big.size - big.free) : (root.used || 0) * 1024;
		const stSize = big ? big.size : (root.total || 0) * 1024;
		const stName = big ? big.mount : '/';
		const stPct = pct(stUsed, stSize);

		/* firmware + local time (mirror stock 10_system) */
		const luciver = (luci.branch || 'LuCI') + ' ' + (luci.revision || '');
		const firmware = (L.isObject(board.release) ? board.release.description + ' / ' : '') + luciver;
		let datestr = '';
		if (unixtime) {
			const zn = uci.get('system', '@system[0]', 'zonename')?.replaceAll(' ', '_') || 'UTC';
			try {
				datestr = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium', timeZone: zn }).format(new Date(unixtime * 1000));
			} catch (e) { datestr = new Date(unixtime * 1000).toISOString().replace('T', ' ').slice(0, 19); }
		}

		/* KPI: load sparkline */
		const h = this.loadHistory, n = h.length, W = 52, H = 20,
		      mx = Math.max.apply(null, h.concat([0.1]));
		const spark = h.map((v, i) => {
			const x = n > 1 ? (i / (n - 1)) * W : 0;
			const y = H - (v / mx) * (H - 4) - 2;
			return x.toFixed(1) + ',' + y.toFixed(1);
		}).join(' ');

		const memU = hb(used), stU = hb(stUsed);
		const memBadgeCls = memPct >= 90 ? 'danger' : (memPct >= 75 ? 'warn' : 'accent');

		const kpi = `
		<div class="fs-kpis">
			<div class="fs-kpi">
				<div class="fs-kpi-head"><span class="fs-kpi-cap">${_('Load avg')}</span>
					<svg width="52" height="20" viewBox="0 0 52 20" fill="none"><polyline points="${spark}" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
				</div>
				<div class="fs-kpi-val">${l1.toFixed(2)}</div>
				<div class="fs-kpi-sub">5${_('m')} ${l5.toFixed(2)} · 15${_('m')} ${l15.toFixed(2)}</div>
			</div>
			<div class="fs-kpi">
				<div class="fs-kpi-head"><span class="fs-kpi-cap">${_('Memory')}</span><span class="fs-badge ${memBadgeCls}">${memPct}%</span></div>
				<div class="fs-kpi-val">${memU.v.toFixed(0)}<span>${memU.u}</span></div>
				<div class="fs-kpi-sub">${_('of')} ${esc(fmt(total, 2))}</div>
			</div>
			<div class="fs-kpi">
				<div class="fs-kpi-head"><span class="fs-kpi-cap">${_('Storage')}</span><span class="fs-badge accent">${stPct}%</span></div>
				<div class="fs-kpi-val">${stU.v.toFixed(0)}<span>${stU.u}</span></div>
				<div class="fs-kpi-sub">${esc(stName)} · ${esc(fmt(stSize, 2))}</div>
			</div>
			<div class="fs-kpi">
				<div class="fs-kpi-head"><span class="fs-kpi-cap">${_('Uptime')}</span><span class="fs-dot"></span></div>
				<div class="fs-kpi-val">${upd}<span>${_('days')}</span></div>
				<div class="fs-kpi-sub">${uph}h ${upm}m ${ups}s</div>
			</div>
		</div>`;

		const sysRows = [
			[_('Hostname'), board.hostname],
			[_('Model'), board.model],
			[_('Architecture'), board.system],
			[_('Target Platform'), L.isObject(board.release) ? board.release.target : ''],
			[_('Firmware Version'), firmware],
			[_('Kernel Version'), board.kernel],
			[_('Local Time'), datestr]
		].map(r => `<div class="fs-kv"><span>${esc(r[0])}</span><b>${esc(r[1] || '?')}</b></div>`).join('');

		const memCard = meter(_('Available'), available, total, 'var(--good)')
			+ meter(_('Used'), used, total, 'var(--danger)')
			+ (buffered ? meter(_('Buffered'), buffered, total, 'var(--accent)') : '')
			+ (cached ? meter(_('Cached'), cached, total, 'var(--accent)') : '');

		/* storage detail: disk / temp / mounts */
		let stRows = meter(_('Disk space'), (root.used || 0) * 1024, (root.total || 0) * 1024, 'var(--good)')
			+ meter(_('Temp space'), (tmp.used || 0) * 1024, (tmp.total || 0) * 1024, 'var(--good)');
		realMounts.forEach(m => { stRows += meter(m.mount, m.size - m.free, m.size, 'var(--accent)'); });

		const box = E('div', { 'class': 'fs-dashroot' });
		box.innerHTML = `
			${kpi}
			<div class="fs-cols">
				<div class="fs-card fs-card-wide">
					<div class="fs-card-title">${_('System')}</div>
					<div class="fs-kvs">${sysRows}</div>
				</div>
				<div class="fs-card">
					<div class="fs-card-title">${_('Memory')}</div>
					<div class="fs-meters">${memCard}</div>
				</div>
			</div>
			<div class="fs-card">
				<div class="fs-card-title">${_('Storage')}</div>
				<div class="fs-meters fs-meters-3">${stRows}</div>
			</div>`;

		this.hideDuplicates();
		return box;
	},

	/* Hide the stock sections this dashboard replaces (System/Memory/Storage).
	 * Use a class (CSS !important) — the stock includes set parentNode.style.display=''
	 * on every poll, which would override an inline style. */
	hideDuplicates() {
		const kill = [ _('System'), _('Memory'), _('Storage') ];
		document.querySelectorAll('.cbi-section').forEach((sec) => {
			if (sec.querySelector('.fs-dashroot')) return;
			const h = sec.querySelector('.cbi-title h3');
			const t = (h && h.firstChild) ? String(h.firstChild.nodeValue || '').trim() : '';
			if (kill.indexOf(t) >= 0) sec.classList.add('fs-dup-hidden');
		});
	}
});
