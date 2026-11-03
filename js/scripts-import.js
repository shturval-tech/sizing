// Разбор JSON, который выдают скрипты kubectl и helm template. Без DOM.
//
// Канонический формат: [{ namespace, workloads: [{ kind, name, replicas, parallelism, storageBytes,
//   containers: [{ name, cpuMillis, memoryBytes }], initContainers: [...] }] }].
// Также принимается плоский массив нагрузок с полем namespace у каждой и массив массивов.

import { KINDS } from './calc.js';
import { newWorkload } from './state.js';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const round2 = (x) => Math.round(x * 100) / 100;

function container(x) {
  const cpu = x.cpuMillis ?? x.cpu ?? 0;
  const mem = x.memoryBytes != null ? x.memoryBytes / MIB : (x.mem ?? 0);
  return { name: x.name || 'container', cpu: Math.round(Number(cpu) || 0), mem: round2(Number(mem) || 0) };
}

function flatten(data) {
  const out = [];
  for (const item of data) {
    if (Array.isArray(item)) out.push(...flatten(item));
    else if (item && Array.isArray(item.workloads)) {
      for (const w of item.workloads) out.push({ ...w, namespace: w.namespace ?? item.namespace });
    } else if (item) out.push(item);
  }
  return out;
}

/* Возвращает { workloads, errors }. Ошибка формата — исключение с понятным текстом. */
/* Все нагрузки попадают в workers: на системные группы прикладные нагрузки не садятся, группу можно сменить после импорта. */
export function parseImport(text) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text || 'null') : text;
  } catch {
    throw new Error('Не удалось разобрать JSON');
  }
  if (!Array.isArray(data)) throw new Error('Ожидается массив нагрузок');
  const workloads = [];
  const errors = [];
  for (const w of flatten(data)) {
    if (!KINDS.includes(w.kind)) {
      errors.push(`${w.name || 'без имени'}: тип ${w.kind} не поддерживается`);
      continue;
    }
    const containers = (w.containers?.length ? w.containers : [{ name: 'app' }]).map(container);
    workloads.push(
      newWorkload({
        ns: w.namespace || w.ns || 'default',
        kind: w.kind,
        name: w.name || 'imported',
        replicas: Math.max(1, Math.round(Number(w.replicas) || 1)),
        parallelism: Math.max(1, Math.round(Number(w.parallelism) || 1)),
        containers,
        init: (w.initContainers || []).map(container),
        pvc: w.kind === 'StatefulSet' ? round2((Number(w.storageBytes) || 0) / GIB) : 0,
      }),
    );
  }
  return { workloads, errors };
}
