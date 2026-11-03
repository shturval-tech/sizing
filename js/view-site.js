// Вкладка «Итого по площадке»: сводные цифры и матрица «кластеры × группы узлов».
import { MIN_NODE, PROVIDERS } from './calc.js';
import { ctx } from './ctx.js';
import { digitsOf, esc, fmt, fmtPlain, gapParts, gapSpans, onClick } from './format.js';
import { gapHtml, hasPreset } from './view-summary.js';

const colKey = (it) => (it.kind === 'custom' ? `c:${it.title}` : it.kind);
const csiName = (r) => ({ rawfile: 'Rawfile', provider: 'CSI провайдера', nfs: 'NFS' }[r.csi]);
const ceil = (x) => Math.max(0, Math.ceil(x - 1e-9));

/* Колонки: control-plane, infra, ingress, workers, затем пользовательские; только где есть узлы. */
export function siteColumns(results) {
  const cols = [];
  for (const k of ['cp', 'infra', 'ingress', 'worker']) {
    const t = results.flatMap(({ result }) => (result.empty ? [] : result.groups)).find((it) => it.kind === k && it.n);
    if (t) cols.push({ key: k, title: t.title });
  }
  for (const { result } of results) {
    if (result.empty) continue;
    for (const it of result.groups) {
      if (it.kind === 'custom' && it.n && !cols.some((c) => c.key === colKey(it))) cols.push({ key: colKey(it), title: it.title });
    }
  }
  return cols;
}

function poolCell(cluster, n, d) {
  if (!n || !n.n) return '<td class="pool-cell empty">—</td>';
  const disk = `<div class="sub">диск ${n.disk} ГиБ${n.localDisk > 0 ? ` + ${n.localDisk} под PVC` : ''}</div>`;
  const caps = n.provider === 'capsm' && cluster.provider !== 'capsm' ? '<div class="sub">CAPSM</div>' : '';
  const gap = gapHtml(n, 1);
  const rec = hasPreset(n) ? `<div class="sub">рекоменд. ${fmt(n.recCpu, d)} · ${fmt(n.recMem, d)}</div>${gap ? `<div class="sub">${gap}</div>` : ''}` : '';
  return `<td class="pool-cell"><div class="cnt">${n.n} ×</div><div class="size">${fmt(n.cpu, d)} vCPU · ${fmt(n.mem, d)} ГиБ</div>${caps}${rec}${disk}</td>`;
}

const kpi = (label, value, sub) => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

export function renderSite() {
  const { results, sum, delta, unmapped } = ctx.site;
  const st = ctx.st;
  const cols = siteColumns(results);
  const itemOf = (r, key) => (r.empty ? null : r.groups.find((it) => colKey(it) === key && it.n));
  const sumDigits = results.some(({ cluster }) => !cluster.roundUp) ? 1 : 0;

  const rows = results.map(({ cluster: x, result: r }) => {
    const d = digitsOf(x);
    const warns = r.warns.length;
    const name = `<td class="name-cell">
      <b>${esc(x.name)}</b>
      <div class="meta"><span class="chip">${PROVIDERS[x.provider].title}</span> <span class="chip">${r.csi ? csiName(r) : 'Rawfile'}</span>${
        warns ? ` <span class="chip warn" title="${esc(r.warns.map((w) => w.text).join(' '))}">предупреждений: ${warns}</span>` : ''}</div>
      <button class="btn sm" style="margin-top:6px" ${onClick('openCluster', x.id)}>Открыть</button></td>`;
    if (r.empty) return `<tr>${name}<td colspan="${cols.length + 2}" class="pool-cell empty">${esc(r.warns[0]?.text || 'Нет узлов')}</td></tr>`;
    const disk = r.csi === 'rawfile' ? r.tot.localDisk : r.tot.extDisk;
    const diskText = disk ? `${fmtPlain(ceil(disk))} ГиБ<div class="sub">${r.csi === 'rawfile' ? 'локально' : csiName(r)}</div>` : '0';
    const g = gapParts(r.gap.cpu, r.gap.cpuSet, r.gap.mem, r.gap.memSet);
    return `<tr>${name}
      ${cols.map((c) => poolCell(x, itemOf(r, c.key), d)).join('')}
      <td class="tot-cell"><div class="size">${fmt(r.tot.cpu, d)} vCPU · ${fmt(r.tot.mem, d)} ГиБ</div><div class="sub">${r.tot.nodes} узлов</div>${g.length ? `<div class="sub">${gapSpans(g)}</div>` : ''}</td>
      <td class="num">${diskText}</td></tr>`;
  }).join('');

  const colSum = (key) => results.reduce((a, { result: r }) => {
    const n = itemOf(r, key);
    if (!n) return a;
    const o = { ...a, n: a.n + n.n, cpu: a.cpu + n.cpu * n.n, mem: a.mem + n.mem * n.n };
    if (n.gapCpu != null) { o.gc += n.gapCpu * n.n; o.cs = true; }
    if (n.gapMem != null) { o.gm += n.gapMem * n.n; o.ms = true; }
    return o;
  }, { n: 0, cpu: 0, mem: 0, gc: 0, gm: 0, cs: false, ms: false });

  const gapAll = gapParts(sum.gap.cpu, sum.gap.cpuSet, sum.gap.mem, sum.gap.memSet);
  const disks = ceil(sum.local) + ceil(sum.ext);
  const totRow = `<tr class="tot"><td>Всего</td>
    ${cols.map((c) => {
      const s = colSum(c.key);
      const g = gapParts(s.gc, s.cs, s.gm, s.ms);
      return s.n
        ? `<td class="pool-cell"><div class="cnt">${s.n} узлов</div><div class="size">${fmt(s.cpu, sumDigits)} vCPU · ${fmt(s.mem, sumDigits)} ГиБ</div>${g.length ? `<div class="sub">${gapSpans(g)}</div>` : ''}</td>`
        : '<td class="pool-cell empty">—</td>';
    }).join('')}
    <td class="tot-cell"><div class="size">${fmt(sum.cpu, sumDigits)} vCPU · ${fmt(sum.mem, sumDigits)} ГиБ</div><div class="sub">${sum.nodes} узлов</div>${gapAll.length ? `<div class="sub">${gapSpans(gapAll)}</div>` : ''}</td>
    <td class="num">${fmtPlain(disks)} ГиБ</td></tr>`;

  const kpis = `<div class="kpis">
    ${kpi('Узлов', sum.nodes, `${results.length} кластеров`)}
    ${kpi('vCPU', fmt(sum.cpu, sumDigits), '')}
    ${kpi('Память', `${fmt(sum.mem, sumDigits)} ГиБ`, '')}
    ${kpi('Системные диски', `${fmtPlain(sum.sysDisk)} ГиБ`, `${MIN_NODE.disk} ГиБ и больше на узел`)}
    ${kpi('Диск под PVC', `${fmtPlain(disks)} ГиБ`, `локально ${fmtPlain(ceil(sum.local))} · внешнее ${fmtPlain(ceil(sum.ext))}`)}
    ${gapAll.length ? kpi('Запас / нехватка', gapSpans(gapAll), 'по группам с заданным размером') : ''}
  </div>`;

  const n = st.clients.length;
  const deltaHtml = !delta ? '' : `<div class="delta" style="margin-bottom:12px"><b>Добавка на существующее управление</b>
    <div class="kv"><span>Всего, ${n} клиентских</span><b>+${fmt(delta.total.cpu / 1000, 2)} vCPU · +${fmt(delta.total.mem / 1024, 2)} ГиБ · +${fmt(delta.total.disk, 1)} ГиБ диска</b></div>
    ${delta.per.map((x) => `<div class="kv"><span>${esc(x.name)}</span><b>+${fmt(x.cpu / 1000, 2)} vCPU · +${fmt(x.mem / 1024, 2)} ГиБ</b></div>`).join('')}
    <div class="hint">Не округляется. Размер узлов управления не пересчитывается.</div></div>`;

  const note = unmapped.length
    ? `<div class="hint" style="margin-top:10px">Чарты бандла без записи в service-map, в расчёт не входят: ${unmapped.map(esc).join(', ')}.</div>` : '';

  document.getElementById('site').innerHTML = `<div class="panel">
    <h3>Итого по площадке</h3>
    ${kpis}
    ${deltaHtml}
    <div class="scroll-x"><table class="matrix"><thead><tr><th>Кластер</th>${cols.map((c) => `<th>${esc(c.title)}<div class="sub">узлов × размер</div></th>`).join('')}<th>Итого кластера</th><th class="num">Диск под PVC</th></tr></thead>
      <tbody>${rows}${totRow}</tbody></table></div>
    ${note}
  </div>`;
}
