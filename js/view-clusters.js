// Вкладка «Кластеры»: список слева и редактор в центре.
import {
  KINDS, MIN_NODE, ONE_OFF, PROVIDERS, SERVICE_GROUP_TITLES, effectiveCsi, isAppGroup, orderedGroups, podRequest,
  resolveServices, serviceGroups, visibleServices,
} from './calc.js';
import { ctx, cur, resultOf } from './ctx.js';
import { digitsOf, esc, fmt, onChange, onClick, onInput } from './format.js';
import { canDeleteClient } from './state.js';

const $ = (id) => document.getElementById(id);

/* ---------- Список кластеров ---------- */

function sideItem(c, selId) {
  const r = resultOf(c);
  const total = c.ng.filter((g) => g.on !== false).reduce((a, g) => a + (Number(g.n) || 0), 0);
  const bad = !r || r.empty || r.warns.some((w) => w.code === 'cp-even' || w.code === 'no-cp');
  const live = !r || r.empty ? 'нет узлов' : bad ? 'ошибка в узлах' : `${fmt(r.tot.cpu, digitsOf(c))} vCPU · ${fmt(r.tot.mem, digitsOf(c))} ГиБ`;
  const tools = c.kind === 'client'
    ? `<span><button class="btn ghost sm" title="Скопировать как шаблон" aria-label="Скопировать кластер" ${onClick('copy', c.id)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5"/></svg></button>${
        canDeleteClient(ctx.st) ? `<button class="btn ghost sm" title="Удалить" aria-label="Удалить кластер" ${onClick('del', c.id)}>✕</button>` : ''}</span>`
    : '';
  return `<div class="item ${c.id === selId ? 'sel' : ''}" role="button" tabindex="0" ${onClick('sel', c.id)}>
    <div class="row"><b>${esc(c.name)}</b>${tools}</div>
    <small>${PROVIDERS[c.provider].title} · ${total} узлов</small>
    <div class="live ${bad ? 'bad' : ''}">${live}</div></div>`;
}

export function renderSide() {
  const sel = cur();
  const st = ctx.st;
  $('side').innerHTML = `
    ${st.mode === 'new' ? `<div class="sep">Управление</div>${sideItem(st.mgmt, sel.id)}` : '<div class="existing-note">Кластер управления уже есть и не пересчитывается.</div>'}
    <div class="sep">Клиентские кластеры</div>
    ${st.clients.length ? st.clients.map((c) => sideItem(c, sel.id)).join('') : '<div class="existing-note">Клиентских кластеров нет, считается только управление.</div>'}
    <button class="btn" style="width:100%" ${onClick('add')}>+ Добавить клиентский кластер</button>`;
}

/* ---------- Редактор ---------- */

const TABS = [['nodes', 'Узлы'], ['services', 'Сервисы'], ['storage', 'Хранилище'], ['workloads', 'Прикладные нагрузки']];

export function renderMain() {
  const c = cur();
  const tab = {
    nodes: tabNodes, services: tabServices, storage: tabStorage, workloads: tabWorkloads,
  }[c.tab] || tabNodes;
  $('main').innerHTML = `
    <div class="tabs" role="tablist">${TABS.map(([id, title]) =>
      `<button class="tab ${c.tab === id ? 'active' : ''}" role="tab" aria-selected="${c.tab === id}" ${onClick('tab', id)}>${title}${
        id === 'workloads' && c.workloads.length ? ` <span class="chip">${c.workloads.length}</span>` : ''}</button>`).join('')}</div>
    ${tab(c)}`;
}

/* ----- Узлы ----- */

function groupRow(c, g) {
  const adv = ctx.st.adv;
  const withProvider = adv && c.provider !== 'capsm';
  const dis = g.on ? '' : 'disabled';
  const name = g.kind === 'custom'
    ? `<input value="${esc(g.title)}" ${onInput('gtxt', g.id)} title="Название группы" aria-label="Название группы">`
    : g.kind === 'ingress'
      ? `<label class="inline"><input type="checkbox" ${g.on ? 'checked' : ''} ${onChange('gon', g.id)}> <b>${esc(g.title)}</b></label>`
      : `<b>${esc(g.title)}</b>`;
  const num = (path, v, title, min = 0) =>
    `<input type="number" min="${min}" value="${v}" ${dis} title="${title}" aria-label="${title}" ${onInput('gn', g.id, path)}>`;
  const size = (k, title) =>
    `<input type="number" min="${MIN_NODE[k]}" step="any" value="${g.size[k]}" placeholder="авто, от ${MIN_NODE[k]}" ${dis} title="${title}. Минимум ${MIN_NODE[k]}" aria-label="${title}" ${onInput('gsize', g.id, k)} ${onChange('gnorm')}>`;
  const provider = g.kind === 'cp'
    ? ''
    : `<select ${dis} title="Провайдер группы узлов" aria-label="Провайдер группы" ${onChange('gprov', g.id)}>
        <option value="" ${g.provider === '' ? 'selected' : ''}>Как у кластера</option>
        <option value="capsm" ${g.provider === 'capsm' ? 'selected' : ''}>${PROVIDERS.capsm.title}</option></select>`;
  return `<tr>
    <td>${name}${g.kind === 'ingress' ? '<div class="hint">по желанию, сервисы трафика</div>' : ''}</td>
    <td>${num('n', g.n, 'Число узлов', g.kind === 'cp' ? 1 : 0)}</td>
    <td>${size('cpu', 'vCPU на узел')}</td>
    <td>${size('mem', 'ГиБ на узел')}</td>
    <td><input type="number" min="${MIN_NODE.disk}" value="${g.disk}" ${dis} title="Системный диск узла, ГиБ. Минимум ${MIN_NODE.disk}" aria-label="Системный диск узла" ${onInput('gdisk', g.id)} ${onChange('gnorm')}></td>
    ${withProvider ? `<td>${provider}</td>` : ''}
    ${adv ? `<td>${num('reserve.cpu', g.reserve.cpu, 'Резерв ОС и kubelet, милли-CPU')}</td><td>${num('reserve.mem', g.reserve.mem, 'Резерв ОС и kubelet, МиБ')}</td>` : ''}
    <td>${g.kind === 'custom' ? `<button class="btn ghost sm" title="Удалить группу" aria-label="Удалить группу" ${onClick('delGroup', g.id)}>✕</button>` : ''}</td></tr>`;
}

function tabNodes(c) {
  const adv = ctx.st.adv;
  const withProvider = adv && c.provider !== 'capsm';
  const cp = c.ng.find((g) => g.id === 'cp');
  const cpOdd = Number(cp.n) % 2 === 0 && Number(cp.n) > 0;
  return `
    <div class="grid">
      <div class="field"><label>Название</label><input value="${esc(c.name)}" ${c.kind === 'mgmt' ? 'disabled' : ''} ${onInput('name')}></div>
      <div class="field"><label>Провайдер</label>
        <select ${onChange('provider')}>${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${c.provider === k ? 'selected' : ''}>${v.title}</option>`).join('')}</select>
        ${c.kind === 'mgmt' ? '<div class="hint">Провайдер самого кластера управления. Операторы провайдеров для клиентских кластеров от него не зависят.</div>' : ''}</div>
      <div class="field"><label>Запас, %</label><input type="number" min="0" value="${c.headroom}" ${onInput('num', 'headroom')}><div class="hint">По умолчанию 20</div></div>
      <div class="field"><label>Округление</label>
        <label class="inline tall"><input type="checkbox" ${c.roundUp ? 'checked' : ''} ${onChange('check', 'roundUp')}> Округлять размер узла</label>
        <div class="hint">CPU до целого vCPU, память до чётного ГиБ</div></div>
    </div>
    <div class="between" style="margin-top:18px">
      <h3 style="margin:0">Группы узлов</h3>
      <label class="inline"><input type="checkbox" ${adv ? 'checked' : ''} ${onChange('adv')}> Дополнительные параметры узлов</label>
    </div>
    <table class="groups-table"><thead><tr><th>Группа</th><th>Узлов</th><th>vCPU на узел</th><th>ГиБ на узел</th><th>Диск узла, ГиБ</th>${withProvider ? '<th>Провайдер группы</th>' : ''}${adv ? '<th>Резерв, m CPU</th><th>Резерв, МиБ</th>' : ''}<th></th></tr></thead>
      <tbody>${orderedGroups(c).map((g) => groupRow(c, g)).join('')}</tbody></table>
    <div class="hint err" id="cp-hint">${cpOdd ? 'Число control-plane узлов должно быть нечётным' : ''}</div>
    <div class="toolbar" style="margin-top:8px"><button class="btn sm" ${onClick('addGroup')}>+ Группа узлов</button>${withProvider ? ` <button class="btn sm" ${onClick('addGroup', 'capsm')}>+ Группа CAPSM</button>` : ''}</div>
    <div class="hint">Минимальный размер узла: ${MIN_NODE.cpu} vCPU, ${MIN_NODE.mem} ГиБ RAM, диск ${MIN_NODE.disk} ГиБ. Ниже нельзя: расчёт и заданный размер поднимаются до минимума.${withProvider ? ' Группу узлов CAPSM можно добавить в кластер любого другого провайдера, control-plane остаётся у провайдера кластера.' : ''}</div>
    <div class="hint">Размер узла: оставьте «авто», чтобы калькулятор подобрал его сам, или задайте заранее. Тогда в итогах показан запас или нехватка относительно рекомендуемого размера.${adv ? ' Резерв ОС и kubelet по умолчанию 500m и 1024 МиБ (1Gi).' : ' Резерв ОС и kubelet, провайдер группы и группа CAPSM скрыты, включите «Дополнительные параметры узлов».'}</div>
    <div class="alert info">Сервисы платформы размещаются по приоритету: <b>infra → worker → control-plane</b>. NGINX Ingress Controller идёт на группу <b>ingress</b>, если она включена. Gateway API работает через DaemonSet cilium-envoy, он стоит на каждом узле всегда, в том числе при NGINX. В пользовательские группы попадают только нагрузки, которым эта группа назначена.</div>`;
}

/* ----- Сервисы ----- */

function tabServices(c) {
  const cat = ctx.cat;
  const state = resolveServices(cat, c, { providersUsed: new Set(ctx.st.clients.map((x) => x.provider)) });
  const visible = visibleServices(cat, c.kind);
  const groups = serviceGroups(cat, c.kind);
  const selected = new Set(['Critical', ...c.groups]);
  const by = Object.fromEntries(cat.services.map((s) => [s.name, s]));

  const cards = groups.map((g) => {
    const lock = g === 'Critical';
    const on = selected.has(g);
    const count = visible.filter((s) => s.group === g).length;
    return `<label class="gcard ${on ? 'sel' : ''} ${lock ? 'lock' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''} ${lock ? 'disabled' : ''} ${onChange('group', g)}>
      <div><b>${esc(SERVICE_GROUP_TITLES[g] || g)}</b><div class="hint">${count} сервисов${lock ? ' · нельзя отключить' : ''}</div></div></label>`;
  }).join('');

  const list = visible.map((s) => {
    const isGatewayIngress = s.name === 'shturval-ingress-controller' && c.kind === 'mgmt';
    const dis = s.critical || isGatewayIngress || (s.name === 'shturval-ingress-controller' && c.traffic === 'gateway');
    const miss = state.missing.has(s.name);
    const deps = s.dep.filter((d) => by[d]).length;
    return `<label class="${miss ? 'miss' : ''}" title="${esc(s.description)}">
      <input type="checkbox" ${state.on.has(s.name) ? 'checked' : ''} ${dis ? 'disabled' : ''} ${onChange('svc', s.name)}>
      <span>${esc(s.uiName || s.name)}<div class="hint">${esc(SERVICE_GROUP_TITLES[s.group] || s.group)}${deps ? ` · зависит от ${deps}` : ''}${s.critical ? ' · критический' : ''}</div></span></label>`;
  }).join('');

  const adv = c.advServices;
  const missText = state.missing.size
    ? `<div class="alert fail">Выключена зависимость, от которой зависят другие сервисы: ${[...state.missing].map((m) => esc(by[m]?.uiName || m)).join(', ')}.</div>`
    : '<div class="alert info">При выборе сервиса зависимые сервисы добавляются автоматически и снимаются, когда на них никто не опирается.</div>';
  const unmapped = ctx.site?.unmapped?.length
    ? `<div class="hint">Чарты бандла без записи в service-map, в расчёт не входят: ${ctx.site.unmapped.map(esc).join(', ')}.</div>` : '';
  return `
    <h3>Управление HTTP-трафиком</h3>
    <div class="toolbar">
      <div class="seg" role="tablist" aria-label="Управление HTTP-трафиком">
        <button role="tab" aria-selected="${c.traffic === 'nginx' && c.kind !== 'mgmt'}" class="${c.traffic === 'nginx' && c.kind !== 'mgmt' ? 'on' : ''}" ${c.kind === 'mgmt' ? 'disabled' : ''} ${onClick('traffic', 'nginx')}>NGINX Ingress Controller</button>
        <button role="tab" aria-selected="${c.traffic === 'gateway' || c.kind === 'mgmt'}" class="${c.traffic === 'gateway' || c.kind === 'mgmt' ? 'on' : ''}" ${onClick('traffic', 'gateway')}>Gateway API</button>
      </div>
      ${c.kind === 'mgmt' ? '<span class="hint">У кластера управления зафиксирован Gateway API</span>' : ''}
    </div>
    ${c.kind === 'mgmt' ? `<label class="inline" style="margin:6px 0"><input type="checkbox" ${c.replicator ? 'checked' : ''} ${onChange('check', 'replicator')}> Репликатор кластеров (shturval-replicator, только на управлении)</label>` : ''}
    <div class="between" style="margin:18px 0 10px">
      <h3 style="margin:0">Сервисы платформы</h3>
      <label class="inline">Показать расширенные настройки <input type="checkbox" ${adv ? 'checked' : ''} ${onChange('advServices')}></label>
    </div>
    ${adv ? `${missText}<div class="svc-list">${list}</div>` : `<div class="group-cards">${cards}</div>`}
    <div class="hint" style="margin-top:10px">Включено сервисов: ${state.charts.size}</div>
    ${unmapped}`;
}

/* ----- Хранилище ----- */

function tabStorage(c) {
  const p = PROVIDERS[c.provider];
  const csi = effectiveCsi(c);
  const opt = (id, title, desc, disabled) => `<button class="rcard ${csi === id ? 'sel' : ''}" ${disabled ? 'disabled' : ''} aria-pressed="${csi === id}" ${onClick('csi', id)}>
    <b>${title}</b><small>${desc}</small></button>`;
  const provider = c.kind === 'mgmt'
    ? opt('provider', 'CSI провайдера', 'На кластер управления не ставится: CSI провайдеров в service-map только для клиентских кластеров.', true)
    : opt('provider', p.csi ? `CSI провайдера: ${p.csiTitle}` : 'CSI провайдера',
      p.csi ? 'Внешний том 1 к 1 к запросу PVC. Локальный диск узла не растёт.' : 'Для выбранного провайдера недоступен', !p.csi);
  return `
    <h3>Тип CSI кластера</h3>
    <p class="muted" style="margin-top:0">Определяет, куда попадает диск платформенных и прикладных PVC.</p>
    <div class="radio-cards">
      ${opt('rawfile', 'Rawfile (локальное хранение)', 'По умолчанию. Размер PVC занимает локальный диск узла своей группы.', false)}
      ${provider}
      ${opt('nfs', 'NFS', 'Квота на внешнем NFS-сервере. Локальный диск узла не растёт.', false)}
    </div>
    <div class="alert info" style="margin-top:14px">CephFS и CephRBD в первой версии не поддерживаются.</div>
    <div class="alert warn">Импортированные PVC считаются в выбранный тип CSI. StorageClass скрипты не определяют.</div>`;
}

/* ----- Прикладные нагрузки ----- */

const groupSelect = (c, value, change) =>
  `<select aria-label="Группа узлов" ${change}>${orderedGroups(c).filter((g) => g.on !== false && isAppGroup(g)).map((g) =>
    `<option value="${esc(g.id)}" ${value === g.id ? 'selected' : ''}>${esc(g.title)}${Number(g.n) ? '' : ' (нет узлов)'}</option>`).join('')}</select>`;

const podText = (w) => {
  const r = podRequest(w.containers, w.init);
  return `${Math.round(r.cpu)} м · ${Math.round(r.mem)} МиБ`;
};

function contRows(w, i, key) {
  return w[key].map((x, j) => `<tr>
    <td><input value="${esc(x.name)}" aria-label="Имя контейнера" ${onInput('wtxt', i, `${key}.${j}.name`)}></td>
    <td><input type="number" min="0" value="${x.cpu}" aria-label="CPU, м" ${onInput('wn', i, `${key}.${j}.cpu`)}></td>
    <td><input type="number" min="0" value="${x.mem}" aria-label="Память, МиБ" ${onInput('wn', i, `${key}.${j}.mem`)}></td>
    <td><button class="btn ghost sm" aria-label="Удалить контейнер" ${key === 'containers' && w.containers.length === 1 ? 'disabled title="Нужен хотя бы один контейнер"' : ''} ${onClick('delCont', i, key, j)}>✕</button></td></tr>`).join('');
}

function tabWorkloads(c) {
  const r = resultOf(c);
  const oneOffN = c.workloads.filter((w) => ONE_OFF.includes(w.kind)).length;
  const rows = c.workloads.map((w, i) => {
    const oneOff = ONE_OFF.includes(w.kind);
    const count = w.kind === 'DaemonSet' ? '<span class="muted">по узлам</span>'
      : oneOff ? `<input type="number" min="1" value="${w.parallelism}" title="Параллельно (parallelism)" aria-label="Параллельно" ${onInput('wn', i, 'parallelism')}>`
        : `<input type="number" min="1" value="${w.replicas}" title="Реплик" aria-label="Реплик" ${onInput('wn', i, 'replicas')}>`;
    const off = oneOff && !c.includeOneOff;
    return `<tr class="${off ? 'dim' : ''}">
      <td><input value="${esc(w.ns)}" aria-label="Namespace" ${onInput('wtxt', i, 'ns')}></td>
      <td><select aria-label="Тип" ${onChange('wkind', i)}>${KINDS.map((k) => `<option ${w.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
      <td><input value="${esc(w.name)}" aria-label="Имя" ${onInput('wtxt', i, 'name')}></td>
      <td>${count}${oneOff ? '<div class="hint">параллельно</div>' : ''}</td>
      <td><span id="pr-${i}">${podText(w)}</span><div class="hint">${w.containers.length} конт.${w.init.length ? ` + ${w.init.length} init` : ''}</div></td>
      <td><input type="number" min="0" value="${w.pvc}" ${w.kind === 'StatefulSet' ? '' : 'disabled'} title="ГиБ на под" aria-label="PVC, ГиБ на под" ${onInput('wn', i, 'pvc')}></td>
      <td>${groupSelect(c, w.group, onChange('wgroup', i))}</td>
      <td class="nowrap"><button class="btn ghost sm" aria-expanded="${w.open}" title="Контейнеры" aria-label="Контейнеры" ${onClick('wopen', i)}>${w.open ? '▴' : '▾'}</button><button class="btn ghost sm" aria-label="Удалить нагрузку" ${onClick('wdel', i)}>✕</button></td></tr>
      ${w.open ? `<tr class="sub"><td colspan="8">
        <div class="two">
          <div><b>Контейнеры</b>
            <table class="cont-table"><thead><tr><th>Имя</th><th>CPU, м</th><th>Память, МиБ</th><th></th></tr></thead><tbody>${contRows(w, i, 'containers')}</tbody></table>
            <button class="btn sm" ${onClick('addCont', i, 'containers')}>+ Контейнер</button></div>
          <div><b>Init-контейнеры</b>
            ${w.init.length ? `<table class="cont-table"><thead><tr><th>Имя</th><th>CPU, м</th><th>Память, МиБ</th><th></th></tr></thead><tbody>${contRows(w, i, 'init')}</tbody></table>` : '<div class="hint">Нет init-контейнеров</div>'}
            <button class="btn sm" ${onClick('addCont', i, 'init')}>+ Init-контейнер</button></div>
        </div>
        <div class="hint" style="margin-top:6px">Request пода = max(сумма контейнеров, самый большой init), отдельно для CPU и памяти.</div></td></tr>` : ''}`;
  }).join('');

  const byNs = {};
  c.workloads.forEach((w, i) => (byNs[w.ns] ||= []).push({ w, i }));
  const nsRows = Object.entries(byNs).map(([ns, ws]) => {
    let cpu = 0; let mem = 0; let pvc = 0;
    for (const { w, i } of ws) {
      const pl = r?.placements?.find((p) => p.index === i);
      if (!pl || !pl.pods) continue;
      cpu += pl.pod.cpu * pl.pods;
      mem += pl.pod.mem * pl.pods;
      pvc += w.kind === 'StatefulSet' ? Number(w.pvc || 0) * pl.pods : 0;
    }
    return `<tr><td>${esc(ns)}</td><td>${ws.length}</td><td>${Math.round(cpu)} м</td><td>${Math.round(mem)} МиБ</td><td>${pvc} ГиБ</td>
      <td>${groupSelect(c, ws[0].w.group, onChange('nsGroup', ns))}</td></tr>`;
  }).join('');

  return `
    <div class="toolbar">
      <div class="seg" role="tablist" aria-label="Вид нагрузок">
        <button role="tab" aria-selected="${c.wlView === 'ns'}" class="${c.wlView === 'ns' ? 'on' : ''}" ${onClick('wlView', 'ns')}>По namespace</button>
        <button role="tab" aria-selected="${c.wlView === 'workloads'}" class="${c.wlView === 'workloads' ? 'on' : ''}" ${onClick('wlView', 'workloads')}>По нагрузкам</button>
      </div>
      <label class="inline"><input type="checkbox" ${c.includeOneOff ? 'checked' : ''} ${onChange('check', 'includeOneOff')}> Учесть разовые нагрузки${oneOffN ? ` (${oneOffN})` : ''}</label>
      <span class="grow"></span>
      <button class="btn" ${onClick('openScript', 'kubectl')}>Скрипт kubectl</button>
      <button class="btn" ${onClick('openScript', 'helm')}>Скрипт helm template</button>
      <button class="btn" ${onClick('addWl')}>+ Нагрузка</button>
    </div>
    ${c.workloads.length === 0
      ? '<div class="alert info">Нагрузок пока нет. Запустите скрипт и вставьте результат или добавьте нагрузку вручную. Прикладные нагрузки размещаются на workers или в своих группах узлов, на control-plane, infra и ingress они не ставятся.</div>'
      : c.wlView === 'ns'
        ? `<table><thead><tr><th>Namespace</th><th>Нагрузок</th><th>CPU</th><th>Память</th><th>PVC</th><th>Группа узлов</th></tr></thead><tbody>${nsRows}</tbody></table>`
        : `<div class="scroll-x"><table class="wl-table"><thead><tr><th>Namespace</th><th>Тип</th><th>Имя</th><th>Реплик</th><th>Request пода</th><th>PVC, ГиБ</th><th>Группа узлов</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`}
    <div class="hint" style="margin-top:8px">Job и CronJob входят в расчёт только при включённом флажке «Учесть разовые нагрузки», по числу параллельных подов.</div>`;
}

export const podRequestText = podText;
