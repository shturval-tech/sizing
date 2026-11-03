// Панель со скриптом kubectl или helm template и полем вставки JSON.
import { esc, onClick } from './format.js';

const FILES = { kubectl: 'scripts/kubectl.sh', helm: 'scripts/helm-template.sh' };
const TITLES = { kubectl: 'Скрипт kubectl', helm: 'Скрипт helm template' };
const LEAD = {
  kubectl: 'Читает нагрузки из работающего кластера: все контейнеры и init-контейнеры. Системные namespace платформы пропускаются, флаг --all отключает фильтр. Нужны kubectl и jq.',
  helm: 'Читает локальный чарт или уже отрендеренный YAML без доступа к кластеру. Нужны helm, yq и jq.',
};
const MIB = 1024 * 1024;
const cache = new Map();

export async function scriptText(kind) {
  if (!cache.has(kind)) {
    const res = await fetch(FILES[kind]);
    if (!res.ok) throw new Error(`Не удалось загрузить скрипт (${res.status})`);
    cache.set(kind, await res.text());
  }
  return cache.get(kind);
}

export function sampleImport() {
  return [
    {
      namespace: 'shop',
      workloads: [
        {
          kind: 'Deployment', name: 'api', replicas: 3,
          containers: [{ name: 'api', cpuMillis: 500, memoryBytes: 768 * MIB }, { name: 'istio-proxy', cpuMillis: 100, memoryBytes: 128 * MIB }],
          initContainers: [{ name: 'migrate', cpuMillis: 800, memoryBytes: 512 * MIB }],
        },
      ],
    },
    {
      namespace: 'data',
      workloads: [
        { kind: 'StatefulSet', name: 'postgres', replicas: 3, storageBytes: 200 * 1024 * MIB, containers: [{ name: 'postgres', cpuMillis: 1000, memoryBytes: 4096 * MIB }, { name: 'exporter', cpuMillis: 50, memoryBytes: 64 * MIB }] },
        { kind: 'DaemonSet', name: 'log-shipper', containers: [{ name: 'shipper', cpuMillis: 50, memoryBytes: 64 * MIB }] },
      ],
    },
    {
      namespace: 'billing',
      workloads: [{ kind: 'CronJob', name: 'nightly-report', parallelism: 2, containers: [{ name: 'report', cpuMillis: 1000, memoryBytes: 2048 * MIB }] }],
    },
  ];
}

export async function openScript(kind) {
  const dlg = document.getElementById('script-dialog');
  let code;
  try {
    code = await scriptText(kind);
  } catch (e) {
    code = `# ${e.message}`;
  }
  document.getElementById('script-body').innerHTML = `
    <div class="between"><h3 style="margin:0">${TITLES[kind]}</h3><button class="btn ghost" aria-label="Закрыть" ${onClick('closeScript')}>✕</button></div>
    <p class="muted">${LEAD[kind]}</p>
    <div class="toolbar"><button class="btn sm" ${onClick('copyScript', kind)}>Копировать скрипт</button></div>
    <pre>${esc(code)}</pre>
    <h3>Вставьте результат (workloads.json)</h3>
    <textarea id="paste" aria-label="Результат скрипта в формате JSON" placeholder='[{"namespace":"shop","workloads":[{"kind":"Deployment","name":"api","replicas":3,"containers":[{"name":"api","cpuMillis":500,"memoryBytes":805306368}],"initContainers":[]}]}]'></textarea>
    <div class="hint">Формат один для обоих скриптов. Поддерживаются Deployment, StatefulSet, DaemonSet, Job, CronJob. После импорта значения и группу узлов можно править.</div>
    <div class="toolbar" style="margin-top:12px"><button class="btn primary" ${onClick('applyPaste')}>Разобрать и добавить</button><button class="btn" ${onClick('fillSample')}>Подставить пример</button></div>`;
  if (!dlg.open) dlg.showModal();
}

export function closeScript() {
  const dlg = document.getElementById('script-dialog');
  if (dlg.open) dlg.close();
}
