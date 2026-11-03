// Загрузка каталогов релизов. Страницу открывают через статический сервер: каталоги идут через fetch.

export async function loadIndex() {
  const res = await fetch('catalog/index.json');
  if (!res.ok) throw new Error(`Не удалось загрузить список релизов (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data.releases) || !data.releases.length) throw new Error('Список релизов пуст');
  return data.releases;
}

const cache = new Map();

export async function loadCatalog(release) {
  if (cache.has(release.version)) return cache.get(release.version);
  const res = await fetch(`catalog/${release.file}`);
  if (!res.ok) throw new Error(`Не удалось загрузить каталог ${release.version} (${res.status})`);
  const cat = validateCatalog(await res.json());
  cache.set(release.version, cat);
  return cat;
}

export function validateCatalog(cat) {
  for (const key of ['version', 'services', 'charts', 'embedded', 'static', 'missingRequests', 'unmapped']) {
    if (!(key in cat)) throw new Error(`В каталоге нет поля ${key}`);
  }
  return cat;
}

/* Версия сборки: файл есть только в dist/, при разработке из site/ его нет. */
export async function loadVersion() {
  try {
    const res = await fetch('version.json');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
