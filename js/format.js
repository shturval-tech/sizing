// Мелкие помощники для разметки и чисел. Без состояния.

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/* Атрибуты делегирования событий: действие и JSON-аргументы. Обработчики живут в actions.js. */
const args = (a) => (a.length ? ` data-a="${esc(JSON.stringify(a))}"` : '');
export const onClick = (name, ...a) => `data-click="${name}"${args(a)}`;
export const onInput = (name, ...a) => `data-input="${name}"${args(a)}`;
export const onChange = (name, ...a) => `data-change="${name}"${args(a)}`;

const nf = new Map();
function numberFormat(d) {
  if (!nf.has(d)) nf.set(d, new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d }));
  return nf.get(d);
}

/* Округление вверх для показа: цифра на экране никогда не меньше расчётной. */
export const fmt = (x, d = 1) => numberFormat(d).format((Math.ceil(x * 10 ** d - 1e-9) / 10 ** d) || 0);
export const fmtPlain = (x, d = 0) => numberFormat(d).format(x);
export const signed = (v) => `${v < -1e-9 ? '−' : '+'}${fmt(Math.abs(v), 1)}`;
export const digitsOf = (c) => (c.roundUp ? 0 : 1);

export const gapClass = (v) => (v < -1e-9 ? 'bad' : 'ok');

export function gapParts(cpu, cpuSet, mem, memSet) {
  const parts = [];
  if (cpuSet) parts.push([cpu, 'vCPU']);
  if (memSet) parts.push([mem, 'ГиБ']);
  return parts;
}

export const gapSpans = (parts) =>
  parts.map(([v, u]) => `<span class="gap ${gapClass(v)}">${signed(v)} ${u}</span>`).join(' · ');

export function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso ?? '') : d.toLocaleDateString('ru-RU');
}
