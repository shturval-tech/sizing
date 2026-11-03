// Обработчики действий интерфейса. Имена совпадают с data-click, data-input и data-change в разметке.
// Последний аргумент каждого обработчика — элемент, на котором сработало событие.
import { loadCatalog } from './catalog.js';
import { ctx, cur } from './ctx.js';
import { parseImport } from './scripts-import.js';
import {
  addClient, addGroup, copyCluster, ct, deleteClient, deleteGroup, newWorkload, normalizeGroups, reconcileRelease,
  setMode, setProvider, setService, toggleGroup,
} from './state.js';
import { podRequestText } from './view-clusters.js';
import { closeScript, openScript, sampleImport, scriptText } from './view-script.js';

const $ = (id) => document.getElementById(id);
const { hooks } = ctx;

export const toast = (text) => {
  const e = $('toast');
  e.textContent = text;
  e.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => e.classList.remove('show'), 2600);
};

const setPath = (obj, path, val) => {
  const p = path.split('.');
  const last = p.pop();
  p.reduce((o, k) => o[k], obj)[last] = val;
};
const int = (v, min = 0) => Math.max(min, Math.floor(Number(v) || 0));
const grp = (c, id) => c.ng.find((g) => g.id === id);
const wl = (i) => cur().workloads[i];

export const actions = {
  /* --- страница --- */
  async setRelease(el) {
    const rel = ctx.releases.find((r) => r.version === el.value);
    if (!rel) return;
    try {
      ctx.cat = await loadCatalog(rel);
    } catch (e) {
      toast(e.message);
      return;
    }
    ctx.st.release = rel.version;
    const dropped = reconcileRelease(ctx.st, ctx.cat);
    hooks.render();
    toast(dropped.length
      ? `Релиз ${rel.version}: сервисы сняты, их нет в релизе: ${dropped.map((d) => d.service).join(', ')}`
      : `Релиз ${rel.version}: топологию и нагрузки сохранили`);
  },
  setMode(mode) { setMode(ctx.st, mode); hooks.render(); },
  view(v) { ctx.st.view = v; hooks.render(); },
  openCluster(id) { ctx.st.sel = id; ctx.st.view = 'clusters'; hooks.render(); },
  openSum() { ctx.st.sumOpen = true; hooks.render(); },
  closeSum() { ctx.st.sumOpen = false; hooks.render(); },
  toggleTheme() {
    const r = document.documentElement;
    const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    r.dataset.theme = dark ? 'light' : 'dark';
  },
  adv(el) { ctx.st.adv = el.checked; hooks.renderMain(); },

  /* --- кластеры --- */
  sel(id) { ctx.st.sel = id; hooks.render(); },
  tab(id) { cur().tab = id; hooks.renderMain(); },
  add() { addClient(ctx.st); hooks.render(); },
  copy(id) { copyCluster(ctx.st, id); hooks.render(); toast('Кластер скопирован как шаблон'); },
  del(id) { deleteClient(ctx.st, id); hooks.render(); },
  name(el) { cur().name = el.value; hooks.refreshLive(); },
  provider(el) { setProvider(cur(), el.value); hooks.render(); },
  num(path, el) { setPath(cur(), path, Math.max(0, Number(el.value) || 0)); hooks.refreshLive(); },
  check(key, el) { cur()[key] = el.checked; hooks.render(); },
  traffic(v) { const c = cur(); c.traffic = c.kind === 'mgmt' ? 'gateway' : v; hooks.render(); },
  csi(v) { cur().csi = v; hooks.render(); },
  wlView(v) { cur().wlView = v; hooks.renderMain(); },

  /* --- группы узлов --- */
  gtxt(id, el) { grp(cur(), id).title = el.value; hooks.refreshLive(); },
  gon(id, el) { grp(cur(), id).on = el.checked; hooks.render(); },
  gn(id, path, el) {
    const g = grp(cur(), id);
    setPath(g, path, int(el.value));
    if (g.kind === 'cp' && path === 'n') {
      const h = $('cp-hint');
      if (h) h.textContent = g.n % 2 === 0 && g.n > 0 ? 'Число control-plane узлов должно быть нечётным' : '';
    }
    hooks.refreshLive();
  },
  gsize(id, k, el) { grp(cur(), id).size[k] = el.value === '' ? '' : Math.max(0, Number(el.value) || 0); hooks.refreshLive(); },
  gdisk(id, el) { grp(cur(), id).disk = Number(el.value) || 0; hooks.refreshLive(); },
  gprov(id, el) { grp(cur(), id).provider = el.value; hooks.render(); },
  gnorm() { normalizeGroups(cur()); hooks.render(); },
  addGroup(provider) { addGroup(cur(), typeof provider === 'string' ? provider : ''); hooks.render(); },
  delGroup(id) { deleteGroup(cur(), id); hooks.render(); },

  /* --- сервисы --- */
  group(g) { toggleGroup(cur(), g); hooks.render(); },
  advServices(el) {
    const c = cur();
    c.advServices = el.checked;
    if (!el.checked) c.svc = {};
    hooks.render();
  },
  svc(name, el) { setService(cur(), name, el.checked); hooks.render(); },

  /* --- прикладные нагрузки --- */
  addWl() {
    const c = cur();
    c.workloads.push(newWorkload({ name: `app-${c.workloads.length + 1}`, replicas: 2, open: true }));
    c.wlView = 'workloads';
    hooks.render();
  },
  wn(i, path, el) {
    setPath(wl(i), path, Math.max(0, Number(el.value) || 0));
    const pr = $(`pr-${i}`);
    if (pr) pr.textContent = podRequestText(wl(i));
    hooks.refreshLive();
  },
  wtxt(i, path, el) { setPath(wl(i), path, el.value); if (path === 'name') hooks.refreshLive(); },
  wkind(i, el) { const w = wl(i); w.kind = el.value; if (w.kind !== 'StatefulSet') w.pvc = 0; hooks.render(); },
  wgroup(i, el) { wl(i).group = el.value; hooks.refreshLive(); },
  nsGroup(ns, el) { for (const w of cur().workloads) if (w.ns === ns) w.group = el.value; hooks.render(); },
  wopen(i) { const w = wl(i); w.open = !w.open; hooks.renderMain(); },
  wdel(i) { cur().workloads.splice(i, 1); hooks.render(); },
  addCont(i, key) {
    const w = wl(i);
    w[key].push(ct(key === 'init' ? `init-${w.init.length + 1}` : `sidecar-${w.containers.length}`, 100, 128));
    hooks.render();
  },
  delCont(i, key, j) {
    const w = wl(i);
    if (key === 'containers' && w.containers.length === 1) return;
    w[key].splice(j, 1);
    hooks.render();
  },

  /* --- скрипты --- */
  openScript(kind) { openScript(kind); },
  closeScript() { closeScript(); },
  async copyScript(kind) {
    try {
      await navigator.clipboard.writeText(await scriptText(kind));
      toast('Скрипт скопирован');
    } catch {
      toast('Не удалось скопировать, выделите текст вручную');
    }
  },
  fillSample() { $('paste').value = JSON.stringify(sampleImport(), null, 2); },
  applyPaste() {
    const c = cur();
    try {
      const { workloads, errors } = parseImport($('paste').value);
      c.workloads.push(...workloads);
      closeScript();
      c.tab = 'workloads';
      c.wlView = 'workloads';
      hooks.render();
      toast(`Добавлено нагрузок: ${workloads.length}${errors.length ? `, пропущено: ${errors.length}` : ''}`);
    } catch (e) {
      toast(e.message);
    }
  },
};

