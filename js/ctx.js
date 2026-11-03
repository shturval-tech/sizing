// Общий контекст приложения: состояние, каталог, последний результат расчёта и точки перерисовки.
import { currentCluster } from './state.js';

export const ctx = {
  st: null,
  cat: null,
  releases: [],
  version: null,
  site: null, // результат calculateSite
  hooks: { render() {}, renderMain() {}, refreshLive() {} },
};

export const cur = () => currentCluster(ctx.st);
export const resultOf = (c) => ctx.site.results.find((r) => r.cluster.id === c.id)?.result;
