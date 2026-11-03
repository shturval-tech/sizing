// Точка входа: загрузка каталога, перерисовка и делегирование событий.
import { actions } from './actions.js';
import { calculateSite } from './calc.js';
import { loadCatalog, loadIndex, loadVersion } from './catalog.js';
import { ctx } from './ctx.js';
import { esc, formatDate, onClick } from './format.js';
import { createState } from './state.js';
import { renderMain, renderSide } from './view-clusters.js';
import { renderSite } from './view-site.js';
import { renderSum, renderSumBar } from './view-summary.js';

const $ = (id) => document.getElementById(id);

function recalc() {
  ctx.site = calculateSite(ctx.cat, ctx.st);
}

function renderMode() {
  const st = ctx.st;
  const seg = (on, act, arg, title) => `<button role="tab" aria-selected="${on}" class="${on ? 'on' : ''}" ${onClick(act, arg)}>${title}</button>`;
  $('modebar').innerHTML = `
    <b>Режим:</b>
    <div class="seg" role="tablist" aria-label="Режим площадки">
      ${seg(st.mode === 'new', 'setMode', 'new', 'Новая площадка')}
      ${seg(st.mode === 'clients', 'setMode', 'clients', 'Клиентские в существующее управление')}
    </div>
    <div class="seg" role="tablist" aria-label="Раздел">
      ${seg(st.view !== 'site', 'view', 'clusters', 'Кластеры')}
      ${seg(st.view === 'site', 'view', 'site', 'Итого по площадке')}
    </div>
    <span class="hint">${st.mode === 'new'
      ? 'Считаем кластер управления и клиентские. Нагрузка клиентов на управление входит в размер его узлов.'
      : 'Считаем только новые клиентские кластеры. Управление не пересчитывается, добавка на него показана отдельно.'}</span>`;
}

function renderHeader() {
  const sel = $('release');
  sel.innerHTML = ctx.releases.map((r) => `<option value="${esc(r.version)}">${esc(r.version)}</option>`).join('');
  sel.value = ctx.st.release;
}

function renderFooter() {
  const v = ctx.version;
  const rel = ctx.releases.find((r) => r.version === ctx.st.release);
  const build = v ? `версия сайта ${esc(v.commit)}${v.dirty ? ' (с локальными правками)' : ''} от ${esc(formatDate(v.builtAt))}` : 'версия сайта: сборка для разработки';
  const data = rel ? `данные релиза ${esc(rel.version)} от ${esc(formatDate(rel.generatedAt))}` : '';
  $('foot-version').innerHTML = [build, data].filter(Boolean).join(' · ');
}

/* Перерисовка с сохранением фокуса: после замены разметки возвращаем его на тот же элемент. */
function withFocus(fn) {
  const a = document.activeElement;
  const key = a && a !== document.body && (a.dataset?.change || a.dataset?.input || a.dataset?.click)
    ? { attr: a.dataset.change ? 'change' : a.dataset.input ? 'input' : 'click', name: a.dataset.change || a.dataset.input || a.dataset.click, args: a.dataset.a || '' }
    : null;
  fn();
  if (!key) return;
  const found = [...document.querySelectorAll(`[data-${key.attr}="${key.name}"]`)].find((e) => (e.dataset.a || '') === key.args);
  found?.focus({ preventScroll: true });
}

function syncDialogs() {
  const st = ctx.st;
  const dlg = $('sum-dialog');
  if (st.sumOpen && st.view === 'clusters') {
    if (!dlg.open) dlg.showModal();
  } else if (dlg.open) {
    st.sumOpen = false;
    dlg.close();
  }
}

function render() {
  recalc();
  const st = ctx.st;
  if (st.view !== 'clusters') st.sumOpen = false;
  document.body.classList.toggle('view-clusters', st.view !== 'site');
  document.body.classList.toggle('view-site', st.view === 'site');
  $('cols').hidden = st.view === 'site';
  $('site').hidden = st.view !== 'site';
  withFocus(() => {
    renderHeader();
    renderMode();
    renderFooter();
    if (st.view === 'site') renderSite();
    else {
      renderSide();
      renderMain();
      renderSum();
      renderSumBar();
    }
  });
  syncDialogs();
}

function renderMainOnly() {
  recalc();
  withFocus(() => {
    renderMain();
    renderSide();
    renderSum();
    renderSumBar();
  });
}

/* Живые цифры без пересборки редактора: поле ввода не теряет фокус. */
function refreshLive() {
  recalc();
  if (ctx.st.view === 'site') renderSite();
  else {
    renderSide();
    renderSum();
    renderSumBar();
  }
}

Object.assign(ctx.hooks, { render, renderMain: renderMainOnly, refreshLive });

function dispatch(attr, e) {
  const el = e.target.closest(`[data-${attr}]`);
  if (!el) return;
  const fn = actions[el.dataset[attr]];
  if (!fn) throw new Error(`нет действия ${el.dataset[attr]}`);
  const args = el.dataset.a ? JSON.parse(el.dataset.a) : [];
  fn(...args, el);
}

function bind() {
  document.addEventListener('click', (e) => dispatch('click', e));
  document.addEventListener('input', (e) => dispatch('input', e));
  document.addEventListener('change', (e) => dispatch('change', e));
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-click]')) {
      e.preventDefault();
      e.target.click();
    }
  });
  $('release').addEventListener('change', (e) => actions.setRelease(e.target));
  $('theme').addEventListener('click', () => actions.toggleTheme());
  for (const id of ['sum-dialog', 'script-dialog']) {
    const dlg = $(id);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }
  $('sum-dialog').addEventListener('close', () => { ctx.st.sumOpen = false; });
  // На широком экране итог стоит в правой колонке, панель не нужна.
  matchMedia('(min-width: 1281px)').addEventListener('change', (e) => {
    if (e.matches && ctx.st.sumOpen) {
      ctx.st.sumOpen = false;
      syncDialogs();
    }
  });
}

async function boot() {
  try {
    ctx.releases = await loadIndex();
    ctx.version = await loadVersion();
    ctx.st = createState();
    ctx.st.release = ctx.releases[0].version;
    ctx.cat = await loadCatalog(ctx.releases[0]);
  } catch (e) {
    $('modebar').innerHTML = `<div class="alert fail">${esc(e.message)}. Откройте страницу через статический сервер, а не как файл.</div>`;
    return;
  }
  ctx.st.sel = ctx.st.mgmt.id;
  bind();
  render();
}

boot();
