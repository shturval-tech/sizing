// Состояние страницы и операции над ним. Без DOM.

import { DEFAULT_HEADROOM, DEFAULT_RESERVE, MIN_NODE, PROVIDERS, effectiveCsi, serviceIndex } from './calc.js';

let seq = 1;
let gseq = 1;
export const resetIds = () => {
  seq = 1;
  gseq = 1;
};

/* size.cpu (vCPU) и size.mem (ГиБ): '' — размер подбирает калькулятор, число — задан заранее.
   disk — системный диск узла, не меньше MIN_NODE.disk. provider: '' — как у кластера, 'capsm' — группа CAPSM. */
export const mkGroup = (id, kind, title, n, on = true) => ({
  id, kind, title, n, on,
  reserve: { ...DEFAULT_RESERVE },
  size: { cpu: '', mem: '' },
  disk: MIN_NODE.disk,
  provider: '',
});

export const DEFAULT_GROUPS = { mgmt: ['Logging', 'Monitoring'], client: [] };

export function newCluster(kind, name) {
  return {
    id: `c${seq++}`,
    kind,
    name,
    provider: kind === 'mgmt' ? 'capsm' : 'vsphere',
    ng: [
      mkGroup('cp', 'cp', 'Control-plane', 3),
      mkGroup('infra', 'infra', 'Infra', kind === 'mgmt' ? 3 : 0),
      mkGroup('ingress', 'ingress', 'Ingress', 2, false),
      mkGroup('worker', 'worker', 'Workers', kind === 'mgmt' ? 0 : 3),
    ],
    headroom: DEFAULT_HEADROOM,
    roundUp: true,
    groups: [...DEFAULT_GROUPS[kind]],
    svc: {},
    traffic: kind === 'mgmt' ? 'gateway' : 'nginx',
    replicator: false,
    csi: 'rawfile',
    workloads: [],
    includeOneOff: false,
    tab: 'nodes',
    wlView: 'workloads',
    advServices: false,
  };
}

export function createState() {
  const mgmt = newCluster('mgmt', 'Кластер управления');
  const first = newCluster('client', 'client-1');
  return {
    mode: 'new', // 'new' — новая площадка, 'clients' — клиентские в существующее управление
    view: 'clusters',
    sumOpen: false,
    adv: false, // «Дополнительные параметры узлов», один на страницу
    release: '',
    mgmt,
    clients: [first],
    sel: mgmt.id,
  };
}

export const allClusters = (st) => [st.mgmt, ...st.clients];
export const findCluster = (st, id) => allClusters(st).find((c) => c.id === id);

export function currentCluster(st) {
  const c = findCluster(st, st.sel);
  if (c && (st.mode === 'new' || c.kind === 'client')) return c;
  return st.mode === 'new' ? st.mgmt : st.clients[0];
}

export function addClient(st) {
  const names = new Set(st.clients.map((x) => x.name));
  let n = st.clients.length + 1;
  while (names.has(`client-${n}`)) n += 1;
  const c = newCluster('client', `client-${n}`);
  st.clients.push(c);
  st.sel = c.id;
  return c;
}

export function copyCluster(st, id) {
  const src = st.clients.find((c) => c.id === id);
  if (!src) return null;
  const c = JSON.parse(JSON.stringify(src));
  c.id = `c${seq++}`;
  c.name = `${src.name}-copy`;
  st.clients.push(c);
  st.sel = c.id;
  return c;
}

/* В новой площадке клиентских кластеров может не быть: считается одно управление.
   В режиме «клиентские в существующее управление» последний клиентский кластер удалить нельзя. */
export const canDeleteClient = (st) => st.mode === 'new' || st.clients.length > 1;

export function deleteClient(st, id) {
  if (!canDeleteClient(st)) return;
  st.clients = st.clients.filter((c) => c.id !== id);
  if (st.sel === id) st.sel = st.clients[0]?.id ?? st.mgmt.id;
}

export function setMode(st, mode) {
  st.mode = mode;
  if (mode === 'clients' && !st.clients.length) addClient(st);
  if (mode === 'clients' && st.sel === st.mgmt.id) st.sel = st.clients[0].id;
}

/* Смена провайдера: CSI провайдера может стать недоступным, группа CAPSM у кластера на CAPSM сбрасывается. */
export function setProvider(c, provider) {
  c.provider = provider;
  if (c.csi === 'provider' && effectiveCsi(c) !== 'provider') c.csi = 'rawfile';
  if (provider === 'capsm') for (const g of c.ng) g.provider = '';
}

export function addGroup(c, provider = '') {
  const n = gseq++;
  const g = mkGroup(`g${n}`, 'custom', provider === 'capsm' ? `CAPSM ${n}` : `Группа ${n}`, 1);
  g.provider = provider;
  c.ng.push(g);
  return g;
}

/* Нагрузки удалённой группы возвращаются на workers. */
export function deleteGroup(c, id) {
  c.ng = c.ng.filter((g) => g.id !== id || g.kind !== 'custom');
  for (const w of c.workloads) if (w.group === id) w.group = 'worker';
}

/* Заданный размер и диск не опускаются ниже минимума узла. */
export function normalizeGroups(c) {
  for (const g of c.ng) {
    g.disk = Math.max(MIN_NODE.disk, Number(g.disk) || 0);
    for (const k of ['cpu', 'mem']) {
      if (g.size[k] !== '') g.size[k] = Math.max(MIN_NODE[k], Number(g.size[k]) || 0);
    }
  }
}

/* Включение сервиса вручную. Зависимости подтянет расчёт; выключение сервиса зависимость не трогает. */
export function setService(c, name, on) {
  c.svc[name] = on;
}

export function toggleGroup(c, group) {
  c.groups = c.groups.includes(group) ? c.groups.filter((g) => g !== group) : [...c.groups, group];
}

export const ct = (name, cpu, mem) => ({ name, cpu, mem });

export const newWorkload = (o = {}) => ({
  ns: 'default', kind: 'Deployment', name: 'app', replicas: 1, parallelism: 1,
  containers: [ct('app', 250, 256)], init: [], pvc: 0, group: 'worker', open: false,
  ...o,
});

/* Смена релиза: выбор сервисов сверяется с новым каталогом, ушедшие сервисы снимаются с предупреждением. */
export function reconcileRelease(st, cat) {
  const by = serviceIndex(cat);
  const dropped = [];
  for (const c of allClusters(st)) {
    for (const name of Object.keys(c.svc)) {
      if (!by[name]) {
        delete c.svc[name];
        dropped.push({ cluster: c.name, service: name });
      }
    }
  }
  return dropped;
}

export { PROVIDERS };
