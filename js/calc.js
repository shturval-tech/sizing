// Расчёт сайзинга. Чистые функции без DOM, работают в браузере и в node --test.
//
// Единицы: CPU в милли-ядрах, память в МиБ (как в каталоге), размер узла в vCPU и ГиБ, диск в ГиБ.

export const MIN_NODE = Object.freeze({ cpu: 4, mem: 8, disk: 60 });
export const DEFAULT_HEADROOM = 20;
export const DEFAULT_RESERVE = Object.freeze({ cpu: 500, mem: 1024 });
export const BUNDLES = ['platform'];

/* Приоритет группы для платформенного fixed: infra, затем worker, затем control-plane. */
export const PLACE_PRIORITY = ['infra', 'worker', 'cp'];
export const GROUP_ORDER = ['cp', 'infra', 'ingress', 'worker'];
export const KINDS = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'];
export const ONE_OFF = ['Job', 'CronJob'];

export const INGRESS_CONTROLLER = 'shturval-ingress-controller';
export const REPLICATOR = 'shturval-replicator';
export const LOCAL_CSI = 'shturval-local-csi';
export const NFS_CSI = 'shturval-nfs-csi';

/* op — оператор провайдера на кластере управления, csi — чарт CSI на клиентском кластере. */
export const PROVIDERS = Object.freeze({
  capsm: { title: 'Штурвал v2 (CAPSM)', op: 'shturval-capsm', csi: null, csiTitle: '' },
  openstack: { title: 'OpenStack', op: 'shturval-capos', csi: 'shturval-capos-csi', csiTitle: 'OpenStack Cinder' },
  ovirt: { title: 'oVirt', op: 'shturval-capov', csi: 'shturval-capov-csi', csiTitle: 'oVirt' },
  vsphere: { title: 'VMware vSphere', op: 'shturval-capvs', csi: 'shturval-capvs-csi', csiTitle: 'vSphere' },
  yandex: { title: 'Yandex Cloud', op: 'shturval-capy', csi: 'shturval-capy-csi', csiTitle: 'Yandex Cloud' },
  vcd: { title: 'VMware Cloud Director', op: 'shturval-capvcd', csi: 'shturval-capvcd-csi', csiTitle: 'vCloud Director' },
  basis: { title: 'Basis Dynamix', op: 'shturval-capbd', csi: null, csiTitle: '' },
});

export const SERVICE_GROUP_TITLES = Object.freeze({
  Critical: 'Критические сервисы',
  BackupAndRestore: 'Резервное копирование и восстановление',
  Logging: 'Логирование',
  AppDelivery: 'Доставка приложений',
  Monitoring: 'Мониторинг',
  LoadBalancing: 'Балансировщик нагрузки',
  InfoSecTools: 'Инструменты ИБ',
});

const EPS = 1e-9;
const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const isHiddenGroup = (g) => g === '' || g === 'NoGroup' || g === undefined || g === null;
const add = (a, b) => ({ cpu: a.cpu + b.cpu, mem: a.mem + b.mem });
const ZERO = () => ({ cpu: 0, mem: 0 });

/* ---------- Размер узла ---------- */

/* CPU вверх до целого vCPU, память вверх до чётного ГиБ. Диск не округляется. */
export function roundNode(cpu, mem, on) {
  if (!on) return { cpu, mem };
  return { cpu: Math.ceil(cpu - EPS), mem: Math.ceil((mem - EPS) / 2) * 2 };
}

/* Request пода как у scheduler: max(сумма обычных, самый большой init), отдельно CPU и память. */
export function podRequest(containers = [], init = []) {
  const sum = (k) => containers.reduce((a, x) => a + num(x[k]), 0);
  const peak = (k) => init.reduce((a, x) => Math.max(a, num(x[k])), 0);
  return { cpu: Math.max(sum('cpu'), peak('cpu')), mem: Math.max(sum('mem'), peak('mem')) };
}

export function podsCount(w, groupNodes, includeOneOff) {
  if (w.kind === 'DaemonSet') return groupNodes;
  if (ONE_OFF.includes(w.kind)) return includeOneOff ? Math.max(1, Math.floor(num(w.parallelism) || 1)) : 0;
  return Math.max(0, Math.floor(num(w.replicas)));
}

/* ---------- Сервисы ---------- */

const scopeOk = (svc, kind) =>
  kind === 'mgmt' ? svc.manager === 'mgmt' || svc.manager === 'base' : svc.manager === 'base' || svc.manager === 'client';

export const serviceIndex = (cat) => Object.fromEntries(cat.services.map((s) => [s.name, s]));

/* Сервисы с группой, доступные на кластере. Скрытые (NoGroup и '') в списке не показываются. */
export function visibleServices(cat, kind, bundles = BUNDLES) {
  return cat.services.filter((s) => bundles.includes(s.bundle) && !isHiddenGroup(s.group) && scopeOk(s, kind));
}

export function serviceGroups(cat, kind, bundles = BUNDLES) {
  const out = [];
  for (const s of visibleServices(cat, kind, bundles)) if (!out.includes(s.group)) out.push(s.group);
  return out.sort((a, b) => (a === 'Critical' ? -1 : b === 'Critical' ? 1 : a.localeCompare(b)));
}

/* Провайдеры клиентских кластеров: от них зависит набор операторов на управлении. */
export function providersUsed(clients) {
  return new Set(clients.map((c) => c.provider));
}

export function effectiveCsi(c) {
  if (c.csi === 'provider' && (c.kind === 'mgmt' || !PROVIDERS[c.provider]?.csi)) return 'rawfile';
  return c.csi || 'rawfile';
}

export function effectiveTraffic(c) {
  return c.kind === 'mgmt' ? 'gateway' : c.traffic || 'nginx';
}

/*
 * Какие сервисы (чарты) стоят на кластере.
 * Сервис с группой включён, только если выбрана его группа или он отмечен вручную (c.svc[name] === true);
 * defaultMode это не перебивает. Скрытые сервисы ставятся по defaultMode, CSI включает выбранный тип CSI.
 * Включение сервиса тянет его dependency; если зависимость выключена вручную, это предупреждение.
 */
export function resolveServices(cat, c, site = {}) {
  const bundles = site.bundles || BUNDLES;
  const by = serviceIndex(cat);
  const used = site.providersUsed || new Set();
  const groups = new Set(['Critical', ...(c.groups || [])]);
  const over = c.svc || {};
  const csi = effectiveCsi(c);
  const providerCsi = c.kind === 'client' ? PROVIDERS[c.provider]?.csi : null;
  const opNames = new Map(Object.values(PROVIDERS).flatMap((p) => [[p.op, p], [`${p.op}-crds`, p]]));
  const on = new Set();
  const warnings = [];

  for (const s of cat.services) {
    if (!bundles.includes(s.bundle) || !scopeOk(s, c.kind)) continue;
    if (!isHiddenGroup(s.group)) {
      if (s.critical || (over[s.name] ?? groups.has(s.group))) on.add(s.name);
      continue;
    }
    if (s.name === NFS_CSI) {
      if (csi === 'nfs') on.add(s.name);
    } else if (Object.values(PROVIDERS).some((p) => p.csi === s.name)) {
      if (csi === 'provider' && providerCsi === s.name) on.add(s.name);
    } else if (opNames.has(s.name)) {
      const p = opNames.get(s.name);
      if (s.mode === 'auto' || [...used].some((k) => PROVIDERS[k] === p)) on.add(s.name);
    } else if (s.mode === 'auto') {
      on.add(s.name);
    }
  }

  const queue = [...on];
  const missing = new Set();
  while (queue.length) {
    const s = by[queue.pop()];
    for (const d of s?.dep || []) {
      const ds = by[d];
      if (!ds || !scopeOk(ds, c.kind) || !bundles.includes(ds.bundle)) continue;
      if (on.has(d)) continue;
      if (over[d] === false) {
        missing.add(d);
        continue;
      }
      on.add(d);
      queue.push(d);
    }
  }
  for (const s of on) {
    for (const d of by[s]?.dep || []) {
      if (by[d] && scopeOk(by[d], c.kind) && !on.has(d) && !(effectiveTraffic(c) === 'gateway' && d === INGRESS_CONTROLLER)) {
        missing.add(d);
      }
    }
  }

  if (effectiveTraffic(c) === 'gateway') on.delete(INGRESS_CONTROLLER);
  else if (by[INGRESS_CONTROLLER] && scopeOk(by[INGRESS_CONTROLLER], c.kind)) on.add(INGRESS_CONTROLLER);

  for (const d of missing) {
    warnings.push({ code: 'dep-off', text: `Сервис «${by[d]?.uiName || d}» выключен, а другие сервисы от него зависят.` });
  }
  return { on, charts: new Set([...on, ...(c.kind === 'mgmt' && c.replicator && cat.charts[REPLICATOR] ? [REPLICATOR] : [])]), missing, warnings };
}

/* ---------- Нагрузка платформы ---------- */

const ONE_POD = (w) => (w.kind === 'DaemonSet' ? 1 : Math.max(1, w.replicas || 0));

/* CCM и прочее, что управляющий кластер держит на каждый управляемый клиентский кластер. */
export function mgmtPerClusterLoad(cat, client) {
  let load = ZERO();
  let mib = 0;
  const maxPods = [];
  for (const e of cat.embedded) {
    for (const w of e.workloads) {
      if (w.scope !== 'mgmtPerCluster') continue;
      if (w.provider && w.provider !== client.provider) continue;
      load = add(load, { cpu: w.pod.cpu * ONE_POD(w), mem: w.pod.mem * ONE_POD(w) });
      mib += (w.pvc || []).reduce((a, p) => a + p.mib, 0);
      maxPods.push({ name: w.name, ...w.pod });
    }
  }
  return { ...load, diskGiB: mib / 1024, maxPods };
}

function platformLoad(cat, c, site, chartsOn) {
  const L = {
    fixed: ZERO(), perNode: ZERO(), perCp: ZERO(), ingress: ZERO(), ingressPod: null,
    hooks: ZERO(), initPeak: ZERO(), outOfCluster: ZERO(), pvcMiB: 0, pvcMaxMiB: 0,
    maxPod: [], missing: [], pods: [],
  };
  const pushPod = (name, pod) => L.maxPod.push({ name, cpu: pod.cpu, mem: pod.mem });

  for (const name of chartsOn) {
    const ch = cat.charts[name];
    if (!ch) continue;
    if (name === INGRESS_CONTROLLER) {
      L.ingress = { ...ch.fixed };
      for (const w of ch.workloads) if (!w.hook && w.kind !== 'DaemonSet') pushIngress(L, w);
      L.pvcMiB += ch.pvcMiB;
      continue;
    }
    L.fixed = add(L.fixed, ch.fixed);
    L.perNode = add(L.perNode, ch.perNode);
    L.hooks = add(L.hooks, ch.hooks);
    L.initPeak = { cpu: Math.max(L.initPeak.cpu, ch.initPeak.cpu), mem: Math.max(L.initPeak.mem, ch.initPeak.mem) };
    L.pvcMiB += ch.pvcMiB;
    for (const p of ch.pvcs) L.pvcMaxMiB = Math.max(L.pvcMaxMiB, p.mib);
    for (const w of ch.workloads) {
      if (!w.hook && (w.kind === 'Deployment' || w.kind === 'StatefulSet')) pushPod(w.name, w.pod);
      for (const t of w.pvc || []) L.pvcMaxMiB = Math.max(L.pvcMaxMiB, t.mib);
    }
  }
  for (const m of cat.missingRequests) {
    if (chartsOn.has(m.chart)) L.missing.push(m);
  }

  for (const e of cat.embedded) {
    const wanted = !e.requires.length || e.requires.some((r) => chartsOn.has(r));
    for (const w of e.workloads) {
      switch (w.scope) {
        case 'perControlplaneNode':
          L.perCp = add(L.perCp, w.pod);
          break;
        case 'perCluster':
          if (!wanted) break;
          if (w.kind === 'DaemonSet') L.perNode = add(L.perNode, w.pod);
          else {
            L.fixed = add(L.fixed, { cpu: w.pod.cpu * ONE_POD(w), mem: w.pod.mem * ONE_POD(w) });
            pushPod(w.name, w.pod);
          }
          break;
        case 'outOfClusters':
          if (c.kind === 'mgmt') L.outOfCluster = add(L.outOfCluster, { cpu: w.pod.cpu * ONE_POD(w), mem: w.pod.mem * ONE_POD(w) });
          break;
        case 'mgmtPerCluster':
        case 'installer':
          break;
        default:
          throw new Error(`неизвестный scope ${w.scope}`);
      }
    }
  }

  L.perNode = add(L.perNode, cat.static.perNode);
  L.perCp = add(L.perCp, cat.static.perControlplaneNode);

  // Управляющий кластер держит добавку на каждый клиентский: только когда считаем всю площадку.
  L.mgmtAdd = ZERO();
  L.mgmtAddDisk = 0;
  if (c.kind === 'mgmt' && site.mode === 'new') {
    for (const cl of site.clients) {
      const m = mgmtPerClusterLoad(cat, cl);
      L.mgmtAdd = add(L.mgmtAdd, m);
      L.mgmtAddDisk += m.diskGiB;
      for (const p of m.maxPods) pushPod(p.name, p);
    }
    L.fixed = add(L.fixed, L.mgmtAdd);
    L.pvcMiB += L.mgmtAddDisk * 1024;
  }
  return L;
}

function pushIngress(L, w) {
  if (!L.ingressPod || w.pod.cpu > L.ingressPod.cpu) L.ingressPod = { name: w.name, cpu: w.pod.cpu, mem: w.pod.mem };
}

/* ---------- Кластер ---------- */

const rank = (g) => {
  const i = GROUP_ORDER.indexOf(g.kind);
  return i === -1 ? GROUP_ORDER.length : i;
};

export const orderedGroups = (c) => [...c.ng].sort((a, b) => rank(a) - rank(b));

const hasNodes = (g) => !!g && g.on !== false && Math.floor(num(g.n)) > 0;

/* Прикладные нагрузки идут только на workers и свои группы, на control-plane, infra и ingress их ставить нельзя. */
export const isAppGroup = (g) => g.kind === 'worker' || g.kind === 'custom';

/* Группа для нагрузки: выбранная, если в ней есть узлы, иначе первая группа workers или своя с узлами. */
export function placeFor(c, id) {
  const groups = orderedGroups(c).filter(isAppGroup);
  const g = groups.find((x) => x.id === id);
  if (hasNodes(g)) return { gid: g.id, fell: false };
  const f = groups.find(hasNodes);
  return { gid: f?.id ?? null, fell: true };
}

const gb = (mib) => mib / 1024;

export function calculateCluster(cat, c, site = { mode: 'new', clients: [] }) {
  const warns = [];
  const warn = (code, text) => warns.push({ code, text });
  const by = serviceIndex(cat);
  const full = { providersUsed: providersUsed(site.clients || []), ...site };
  const svc = resolveServices(cat, c, full);
  svc.warnings.forEach((w) => warns.push(w));
  const csi = effectiveCsi(c);
  if (c.csi === 'provider' && csi !== 'provider') {
    warn('csi-unavailable', c.kind === 'mgmt'
      ? 'На кластер управления CSI провайдера не ставится, считаем Rawfile.'
      : 'У выбранного провайдера нет CSI, считаем Rawfile.');
  }
  const P = platformLoad(cat, c, full, svc.charts);
  const unmappedMissing = new Map();
  for (const m of P.missing) unmappedMissing.set(m.chart, (unmappedMissing.get(m.chart) || 0) + 1);
  for (const [chart, n] of unmappedMissing) {
    warn('missing-requests', `У чарта ${by[chart]?.uiName || chart} не заданы requests у контейнеров: ${n}. Считаем 0.`);
  }

  const groups = orderedGroups(c).filter((g) => g.on !== false);
  const pools = new Map();
  for (const g of groups) {
    const n = Math.max(0, Math.floor(num(g.n)));
    pools.set(g.id, {
      g, n, load: ZERO(), base: { ...P.perNode }, pods: [], pvcMiB: 0, pvcMaxMiB: 0,
      plat: ZERO(), app: ZERO(), appBase: ZERO(),
    });
    if (g.kind === 'cp') pools.get(g.id).base = add(P.perNode, P.perCp);
  }
  const cpg = groups.find((g) => g.kind === 'cp');
  if (!cpg || !pools.get(cpg.id).n) warn('no-cp', 'Нужен хотя бы один control-plane узел.');
  else if (pools.get(cpg.id).n % 2 === 0) warn('cp-even', 'Число control-plane узлов не может быть чётным.');

  const anyNodes = [...pools.values()].some((p) => p.n > 0);
  if (!anyNodes) return { empty: true, warns, groups: [], byId: {}, svc };

  // Платформенный fixed: группа по приоритету; NGINX уходит на включённый ingress.
  const targetKind = PLACE_PRIORITY.find((k) => groups.some((g) => g.kind === k && pools.get(g.id).n > 0));
  const target = pools.get(groups.find((g) => g.kind === targetKind)?.id) || [...pools.values()].find((p) => p.n > 0);
  const ingressPool = [...pools.values()].find((p) => p.g.kind === 'ingress' && p.n > 0);
  if (ingressPool && svc.charts.has(INGRESS_CONTROLLER)) {
    ingressPool.load = add(ingressPool.load, P.ingress);
    ingressPool.plat = add(ingressPool.plat, P.ingress);
    if (P.ingressPod) ingressPool.pods.push(P.ingressPod);
  } else {
    target.load = add(target.load, P.ingress);
    target.plat = add(target.plat, P.ingress);
    if (P.ingressPod) target.pods.push(P.ingressPod);
  }
  target.load = add(target.load, P.fixed);
  target.plat = add(target.plat, P.fixed);
  target.pods.push(...P.maxPod);
  target.pvcMiB += P.pvcMiB;
  target.pvcMaxMiB = Math.max(target.pvcMaxMiB, P.pvcMaxMiB);

  // Прикладные нагрузки.
  let fell = false;
  let skipped = 0;
  let unplaced = 0;
  const placements = [];
  (c.workloads || []).forEach((w, index) => {
    const oneOff = ONE_OFF.includes(w.kind);
    if (oneOff && !c.includeOneOff) {
      skipped++;
      placements.push({ index, gid: null, pods: 0 });
      return;
    }
    const pl = placeFor(c, w.group);
    if (!pl.gid) {
      unplaced++;
      return;
    }
    if (pl.fell) fell = true;
    const pool = pools.get(pl.gid);
    const pod = podRequest(w.containers, w.init);
    const count = podsCount(w, pool.n, c.includeOneOff);
    placements.push({ index, gid: pl.gid, fell: pl.fell, pods: count, pod });
    if (w.kind === 'DaemonSet') {
      pool.base = add(pool.base, pod);
      pool.appBase = add(pool.appBase, pod);
    } else {
      const total = { cpu: pod.cpu * count, mem: pod.mem * count };
      pool.load = add(pool.load, total);
      pool.app = add(pool.app, total);
    }
    // DaemonSet уже входит в base узла, поэтому в «самый крупный под» не попадает.
    if (count > 0 && w.kind !== 'DaemonSet') pool.pods.push({ name: w.name, cpu: pod.cpu, mem: pod.mem, app: true });
    const perPod = w.kind === 'StatefulSet' ? num(w.pvc) * 1024 : 0;
    pool.pvcMiB += perPod * count;
    if (perPod > 0 && count > 0) pool.pvcMaxMiB = Math.max(pool.pvcMaxMiB, perPod);
  });
  if (fell) warn('group-fallback', 'Часть нагрузок попала не в выбранную группу: в ней нет узлов. Нагрузки переехали в группу workers или в свою группу с узлами.');
  if (unplaced) warn('no-app-nodes', `Прикладные нагрузки некуда поставить (${unplaced}): нет узлов в группе workers и в своих группах. На control-plane, infra и ingress они не размещаются.`);
  if (skipped) warn('one-off-skipped', `Разовые нагрузки не учтены: ${skipped}. Включите «Учесть разовые нагрузки» на вкладке нагрузок.`);

  const k = 1 + Math.max(0, num(c.headroom)) / 100;
  const items = [];
  const gap = { cpu: 0, mem: 0, cpuSet: false, memSet: false };
  const groupsOut = {};

  for (const g of groups) {
    const p = pools.get(g.id);
    const reserve = { cpu: num(g.reserve?.cpu ?? DEFAULT_RESERVE.cpu), mem: num(g.reserve?.mem ?? DEFAULT_RESERVE.mem) };
    const disk = Math.max(MIN_NODE.disk, num(g.disk));
    if (!p.n) {
      const empty = { id: g.id, kind: g.kind, title: g.title, n: 0, provider: g.provider || '' };
      items.push(empty);
      groupsOut[g.id] = empty;
      continue;
    }
    const biggest = (key) => p.pods.reduce((a, x) => (x[key] > a.v ? { v: x[key], name: x.name } : a), { v: 0, name: '' });
    const bigCpu = biggest('cpu');
    const bigMem = biggest('mem');
    const avgCpu = p.base.cpu + p.load.cpu / p.n;
    const avgMem = p.base.mem + p.load.mem / p.n;
    const floorCpu = p.base.cpu + bigCpu.v;
    const floorMem = p.base.mem + bigMem.v;
    const byPodCpu = floorCpu > avgCpu + EPS;
    const byPodMem = floorMem > avgMem + EPS;
    const rawCpu = (Math.max(avgCpu, floorCpu) * k + reserve.cpu) / 1000;
    const rawMem = (Math.max(avgMem, floorMem) * k + reserve.mem) / 1024;
    const rounded = roundNode(rawCpu, rawMem, !!c.roundUp);
    const rec = { cpu: Math.max(MIN_NODE.cpu, rounded.cpu), mem: Math.max(MIN_NODE.mem, rounded.mem) };
    const floored = rounded.cpu < MIN_NODE.cpu - EPS || rounded.mem < MIN_NODE.mem - EPS;

    const presetOf = (v, min) => {
      if (v === '' || v === null || v === undefined) return null;
      const x = Number(v);
      return Number.isFinite(x) ? Math.max(min, x) : null;
    };
    const presetCpu = presetOf(g.size?.cpu, MIN_NODE.cpu);
    const presetMem = presetOf(g.size?.mem, MIN_NODE.mem);

    const pvcGiB = gb(p.pvcMiB);
    const item = {
      id: g.id, kind: g.kind, title: g.title, n: p.n, provider: g.provider || '',
      disk, floored, rawCpu, rawMem,
      cpu: presetCpu ?? rec.cpu, mem: presetMem ?? rec.mem,
      recCpu: rec.cpu, recMem: rec.mem, presetCpu, presetMem,
      gapCpu: presetCpu == null ? null : presetCpu - rec.cpu,
      gapMem: presetMem == null ? null : presetMem - rec.mem,
      floor: byPodCpu || byPodMem ? (byPodCpu ? bigCpu.name : bigMem.name) : '',
      base: p.base, requests: p.load, pods: p.pods.length,
      // Среднее на узел, милли-CPU и МиБ: из чего собирается занятое место на узле.
      use: {
        reserve,
        platBase: { cpu: p.base.cpu - p.appBase.cpu, mem: p.base.mem - p.appBase.mem },
        platLoad: { cpu: p.plat.cpu / p.n, mem: p.plat.mem / p.n },
        appBase: p.appBase,
        appLoad: { cpu: p.app.cpu / p.n, mem: p.app.mem / p.n },
      },
      pvc: pvcGiB,
      localDisk: csi === 'rawfile' && pvcGiB > 0 ? Math.max(Math.ceil(pvcGiB / p.n - EPS), Math.ceil(gb(p.pvcMaxMiB) - EPS)) : 0,
    };
    items.push(item);
    groupsOut[g.id] = item;
    if (item.gapCpu != null) {
      gap.cpu += item.gapCpu * p.n;
      gap.cpuSet = true;
    }
    if (item.gapMem != null) {
      gap.mem += item.gapMem * p.n;
      gap.memSet = true;
    }
    if ((item.gapCpu != null && item.gapCpu < -EPS) || (item.gapMem != null && item.gapMem < -EPS)) {
      warn('preset-short', `Группа «${g.title}»: заданного размера узла не хватает.`);
    }
    // Прикладной под крупнее узла (за вычетом резерва) не запустится.
    for (const pod of p.pods) {
      if (!pod.app) continue;
      if (pod.cpu > item.cpu * 1000 - reserve.cpu + EPS || pod.mem > item.mem * 1024 - reserve.mem + EPS) {
        warn('pod-too-big', `Под «${pod.name}» не помещается на узел группы «${g.title}».`);
      }
    }
  }

  if (csi === 'provider') {
    const bad = groups.some((g) => g.provider === 'capsm' && c.provider !== 'capsm' && (groupsOut[g.id]?.pvc || 0) > 0);
    if (bad) warn('capsm-pvc', 'В группе CAPSM есть PVC, а у CAPSM нет CSI провайдера. Выберите Rawfile или NFS.');
  }

  const tot = items.reduce(
    (a, it) => {
      if (!it.n) return a;
      return {
        nodes: a.nodes + it.n,
        cpu: a.cpu + it.cpu * it.n,
        mem: a.mem + it.mem * it.n,
        sysDisk: a.sysDisk + it.disk * it.n,
        pvc: a.pvc + it.pvc,
        localDisk: a.localDisk + it.localDisk * it.n,
      };
    },
    { nodes: 0, cpu: 0, mem: 0, sysDisk: 0, pvc: 0, localDisk: 0 },
  );
  tot.extDisk = csi === 'rawfile' ? 0 : tot.pvc;
  if (csi !== 'rawfile') tot.localDisk = 0;
  tot.svcCount = svc.charts.size;

  return {
    empty: false,
    groups: items,
    byId: groupsOut,
    placements,
    svc,
    csi,
    tot,
    gap,
    warns,
    placeId: target.g.id,
    platform: {
      fixed: P.fixed, perNode: P.perNode, perCp: P.perCp, ingress: P.ingress,
      hooks: P.hooks, initPeak: P.initPeak, outOfCluster: P.outOfCluster, mgmtAdd: P.mgmtAdd,
      pvcGiB: gb(P.pvcMiB),
    },
  };
}

/* Добавка на существующее управление от клиентских кластеров. Не округляется. */
export function mgmtDelta(cat, clients) {
  const per = clients.map((c) => {
    const m = mgmtPerClusterLoad(cat, c);
    return { id: c.id, name: c.name, cpu: m.cpu, mem: m.mem, disk: m.diskGiB };
  });
  const total = per.reduce((a, x) => ({ cpu: a.cpu + x.cpu, mem: a.mem + x.mem, disk: a.disk + x.disk }), { cpu: 0, mem: 0, disk: 0 });
  return { per, total };
}

/* ---------- Площадка ---------- */

export function clustersInUse(st) {
  return st.mode === 'new' ? [st.mgmt, ...st.clients] : st.clients;
}

export function calculateSite(cat, st) {
  const site = { mode: st.mode, clients: st.clients };
  const results = clustersInUse(st).map((c) => ({ cluster: c, result: calculateCluster(cat, c, site) }));
  const sum = { nodes: 0, cpu: 0, mem: 0, sysDisk: 0, local: 0, ext: 0, gap: { cpu: 0, mem: 0, cpuSet: false, memSet: false } };
  for (const { result: r } of results) {
    if (r.empty) continue;
    sum.nodes += r.tot.nodes;
    sum.cpu += r.tot.cpu;
    sum.mem += r.tot.mem;
    sum.sysDisk += r.tot.sysDisk;
    sum.local += r.tot.localDisk;
    sum.ext += r.tot.extDisk;
    sum.gap.cpu += r.gap.cpu;
    sum.gap.mem += r.gap.mem;
    sum.gap.cpuSet ||= r.gap.cpuSet;
    sum.gap.memSet ||= r.gap.memSet;
  }
  return {
    results,
    sum,
    delta: st.mode === 'clients' ? mgmtDelta(cat, st.clients) : null,
    unmapped: cat.unmapped.filter((n) => n !== REPLICATOR && n !== 'shturval-npd'),
  };
}
