// Итог выбранного кластера: правая колонка, нижняя полоса и панель «Подробнее».
import { MIN_NODE } from './calc.js';
import { ctx, cur, resultOf } from './ctx.js';
import { digitsOf, esc, fmt, fmtPlain, gapParts, gapSpans, onClick } from './format.js';

const $ = (id) => document.getElementById(id);

const csiName = (r) => ({ rawfile: 'Rawfile', provider: 'CSI провайдера', nfs: 'NFS' }[r?.csi || 'rawfile']);
export const hasPreset = (it) => it.presetCpu != null || it.presetMem != null;

/* Запас или нехватка по группе: на узел (mult = 1) или на всю группу (mult = число узлов). */
export function gapHtml(it, mult = 1) {
  const parts = [];
  if (it.gapCpu != null) parts.push([it.gapCpu * mult, 'vCPU']);
  if (it.gapMem != null) parts.push([it.gapMem * mult, 'ГиБ']);
  if (!parts.length) return '';
  return `${parts.some(([v]) => v < -1e-9) ? 'нехватка' : 'запас'} ${gapSpans(parts)}`;
}

const roundedOff = (n) => n && !hasPreset(n) && !n.floored && (Math.abs(n.cpu - n.rawCpu) > 1e-6 || Math.abs(n.mem - n.rawMem) > 1e-6);

export function nodeCard(n, c) {
  const d = digitsOf(c);
  if (!n.n) return `<div class="node off"><div class="t"><span>${esc(n.title)}</span></div><div class="big">нет узлов</div></div>`;
  const raw = n.floored && !hasPreset(n)
    ? `<div class="sub">по расчёту ${fmt(n.rawCpu, 1)} vCPU · ${fmt(n.rawMem, 1)} ГиБ, поднято до минимума ${MIN_NODE.cpu} vCPU · ${MIN_NODE.mem} ГиБ</div>`
    : roundedOff(n) ? `<div class="sub">до округления ${fmt(n.rawCpu, 1)} vCPU · ${fmt(n.rawMem, 1)} ГиБ</div>` : '';
  const preset = hasPreset(n)
    ? `<div class="sub">рекомендуется ${fmt(n.recCpu, d)} vCPU · ${fmt(n.recMem, d)} ГиБ</div>
       <div class="sub">на узел: ${gapHtml(n)}</div><div class="sub">на группу: ${gapHtml(n, n.n)}</div>` : '';
  const caps = n.provider === 'capsm' && c.provider !== 'capsm' ? ' · CAPSM' : '';
  const disk = `диск ${n.disk} ГиБ${n.localDisk > 0 ? ` + локальный диск под PVC ${n.localDisk} ГиБ` : ''}`;
  return `<div class="node"><div class="t"><span>${esc(n.title)} · ${n.n} уз.${hasPreset(n) ? ' · размер задан' : ''}${caps}</span>${
    n.floor ? `<span class="chip warn" title="Размер узла ограничен самым крупным подом">по поду ${esc(n.floor)}</span>` : ''}</div>
    <div class="big">${fmt(n.cpu, d)} vCPU · ${fmt(n.mem, d)} ГиБ</div>
    ${raw}${preset}
    <div class="sub">на каждый узел · ${disk}</div></div>`;
}

const mcpu = (v) => `${fmtPlain(Math.round(v))} m`;
const mmem = (v) => `${fmtPlain(Math.round(v))} МиБ`;

const vcpu = (m) => fmtPlain(m / 1000, 2);
const gib = (mib) => fmtPlain(mib / 1024, 2);

/* Куда уходит место на узле группы, в среднем на узел: система, платформа, прикладные нагрузки, остаток. */
function usageBlock(r, c) {
  const groups = r.groups.filter((g) => g.n);
  const row = (label, x, cls = '', title = '') =>
    `<tr class="${cls}"${title ? ` title="${esc(title)}"` : ''}><td>${label}</td><td>${vcpu(x.cpu)}</td><td>${gib(x.mem)}</td></tr>`;
  const sum = (...xs) => xs.reduce((a, x) => ({ cpu: a.cpu + x.cpu, mem: a.mem + x.mem }), { cpu: 0, mem: 0 });
  const tables = groups.map((g) => {
    const u = g.use;
    const size = { cpu: g.cpu * 1000, mem: g.mem * 1024 };
    const platform = sum(u.platBase, u.platLoad);
    const apps = sum(u.appBase, u.appLoad);
    const avail = { cpu: size.cpu - u.reserve.cpu - platform.cpu, mem: size.mem - u.reserve.mem - platform.mem };
    const left = { cpu: avail.cpu - apps.cpu, mem: avail.mem - apps.mem };
    const short = left.cpu < -1e-6 || left.mem < -1e-6;
    return `<table class="usage"><caption>${esc(g.title)} · ${g.n} уз.${hasPreset(g) ? ' · размер задан' : ''}</caption>
      <thead><tr><th>На один узел, в среднем</th><th>vCPU</th><th>ГиБ</th></tr></thead><tbody>
      ${row('Размер узла', size, 'total')}
      ${row('Резерв ОС и kubelet', u.reserve, '', 'Не отдаётся подам: параметр группы «Резерв» в расширенных настройках узлов')}
      ${row('Платформа: DaemonSet и пакеты', u.platBase, '', 'requests сервисов, которые стоят на каждом узле')}
      ${u.platLoad.cpu > 0 || u.platLoad.mem > 0 ? row('Платформа: остальные сервисы', u.platLoad, '', 'Доля на узел от Deployment и StatefulSet платформы, они сидят в этой группе') : ''}
      ${row('Доступно прикладным нагрузкам', avail, 'sub total', 'Размер узла минус резерв ОС и платформа')}
      ${row('Заняли прикладные нагрузки', apps, '', 'requests подов, в том числе DaemonSet нагрузок')}
      ${row(short ? 'Нехватка' : 'Осталось', short ? { cpu: -left.cpu, mem: -left.mem } : left, `total ${short ? 'bad' : ''}`, `В остаток входит запас на рост ${c.headroom} %, который заложен в размер узла`)}
      </tbody></table>`;
  }).join('');
  return `<div class="usage-title">Как заполнены узлы</div>${tables}
    <div class="hint">Значения в requests, среднее по узлам группы. В остаток входит запас на рост ${c.headroom} %, он и округление размера узла дают свободное место. Планировщик распределяет поды неравномерно, поэтому на отдельном узле цифры могут отличаться.</div>`;
}

function platformBlock(r, c) {
  const p = r.platform;
  const row = (label, x, title) => `<div class="kv"${title ? ` title="${esc(title)}"` : ''}><span>${label}</span><span>${mcpu(x.cpu)} · ${mmem(x.mem)}</span></div>`;
  const mgmtAdd = c.kind === 'mgmt' && p.mgmtAdd.cpu > 0 ? row('в том числе от клиентских кластеров', p.mgmtAdd, 'mgmtPerCluster: CCM, автоскейлер и прочее на каждый управляемый кластер') : '';
  const out = c.kind === 'mgmt' && p.outOfCluster.cpu > 0 ? row('вне кластера (systemd)', p.outOfCluster, 'outOfClusters: в размер узлов не входит') : '';
  return `<details class="more"><summary>Из чего складывается нагрузка платформы</summary>
    ${row('Fixed (Deployment, StatefulSet)', p.fixed, 'Делится на узлы группы, куда садится платформа')}
    ${mgmtAdd}
    ${row('На каждый узел (DaemonSet, пакеты)', p.perNode, 'В том числе cilium-envoy')}
    ${c.kind === 'client' || c.kind === 'mgmt' ? row('Дополнительно на control-plane узел', p.perCp, 'etcd, kube-apiserver, kube-vip и другие') : ''}
    ${p.ingress.cpu ? row('NGINX Ingress Controller', p.ingress) : ''}
    ${out}
    ${usageBlock(r, c)}
    <div class="hint">Пик установки (hooks и init-контейнеры) в размер узла не входит: до +${mcpu(p.hooks.cpu)} и +${mmem(p.hooks.mem)} на время установки. Платформа садится на группу «${esc(r.byId[r.placeId]?.title || '')}».</div>
  </details>`;
}

export function deltaHtml(c) {
  const st = ctx.st;
  if (st.mode !== 'clients' || c.kind !== 'client') return '';
  const d = ctx.site.delta?.per.find((x) => x.id === c.id);
  if (!d) return '';
  return `<div class="delta"><b>Добавка на управление от этого кластера</b>
    <div class="kv"><span>CPU</span><b>+${fmt(d.cpu / 1000, 2)} vCPU</b></div>
    <div class="kv"><span>Память</span><b>+${fmt(d.mem / 1024, 2)} ГиБ</b></div>
    <div class="kv"><span>Диск</span><b>+${fmt(d.disk, 1)} ГиБ</b></div>
    <div class="hint">Не округляется. Размер узлов управления не пересчитывается.</div></div>`;
}

export function clusterSummaryHtml(c) {
  const r = resultOf(c);
  if (!r) return '';
  const d = digitsOf(c);
  const gap = r.empty ? '' : gapParts(r.gap.cpu, r.gap.cpuSet, r.gap.mem, r.gap.memSet);
  return `
    <div class="between"><h3 style="margin:0">Итог: ${esc(c.name)}</h3><span class="chip">${csiName(r)}</span></div>
    <div style="margin-top:10px">${r.empty
      ? `<div class="alert fail">${esc(r.warns[0]?.text || 'В кластере нет узлов')}</div>`
      : r.groups.map((n) => nodeCard(n, c)).join('')}</div>
    ${r.empty ? '' : `
    <div class="kv"><span>Всего CPU</span><b>${fmt(r.tot.cpu, d)} vCPU</b></div>
    <div class="kv"><span>Всего памяти</span><b>${fmt(r.tot.mem, d)} ГиБ</b></div>
    ${gap.length ? `<div class="kv"><span>Запас / нехватка по заданным группам</span><b>${gapSpans(gap)}</b></div>` : ''}
    <div class="kv"><span>Системные диски узлов</span><b>${fmtPlain(r.tot.sysDisk)} ГиБ</b></div>
    <div class="kv"><span>${r.csi === 'rawfile' ? 'Локальный диск под PVC' : `Внешнее хранилище, ${csiName(r)}`}</span><b>${fmtPlain(Math.max(0, Math.ceil((r.csi === 'rawfile' ? r.tot.localDisk : r.tot.extDisk) - 1e-9)))} ГиБ</b></div>
    ${r.csi === 'rawfile' && r.tot.pvc > 0 ? `<div class="kv"><span>Запрошено PVC платформой и нагрузками</span><b>${fmtPlain(Math.ceil(r.tot.pvc - 1e-9))} ГиБ</b></div>` : ''}
    <div class="kv"><span>Сервисов платформы</span><b>${r.tot.svcCount}</b></div>
    <div class="hint">Рекомендуемый размер узла = requests × (1 + ${c.headroom} %) + резерв ОС и kubelet группы. Округление: ${c.roundUp ? 'вкл' : 'выкл'}. Минимум узла ${MIN_NODE.cpu} vCPU, ${MIN_NODE.mem} ГиБ.</div>
    ${platformBlock(r, c)}
    ${r.warns.length ? `<ul class="notes">${r.warns.map((w) => `<li>${esc(w.text)}</li>`).join('')}</ul>` : ''}`}
    ${deltaHtml(c)}`;
}

export function renderSum() {
  const html = clusterSummaryHtml(cur());
  $('sum').innerHTML = `<div class="panel sticky">${html}</div>`;
  $('sumdrawer-body').innerHTML = html;
}

export function renderSumBar() {
  const c = cur();
  const r = resultOf(c);
  const d = digitsOf(c);
  const groups = !r || r.empty ? 'нет узлов'
    : r.groups.filter((n) => n.n).map((n) => `${esc(n.title)} ${n.n} × ${fmt(n.cpu, d)}/${fmt(n.mem, d)}`).join(' · ');
  const warns = r?.warns?.length || 0;
  $('sumbar').innerHTML = `
    <b>${esc(c.name)}</b>
    <span class="groups">${groups}</span>
    ${r && !r.empty ? `<span class="tot">${fmt(r.tot.cpu, d)} vCPU · ${fmt(r.tot.mem, d)} ГиБ</span>` : ''}
    ${warns ? `<span class="chip warn" title="Предупреждения">${warns}</span>` : ''}
    <button class="btn sm" ${onClick('openSum')}>Подробнее</button>`;
}

