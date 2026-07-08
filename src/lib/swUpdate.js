// #65 — petit pont entre main.jsx (qui appelle registerSW, hors arbre React)
// et App.jsx (qui affiche le bandeau). Pas de dépendance nouvelle : juste un
// pub-sub minimal en mémoire.
let listeners = [];
let updateSWFn = null;

export function setUpdateSW(fn) {
  updateSWFn = fn;
}

export function notifyNeedRefresh() {
  listeners.forEach(l => l());
}

export function onNeedRefresh(listener) {
  listeners.push(listener);
  return () => { listeners = listeners.filter(l => l !== listener); };
}

export function applyUpdate() {
  return updateSWFn?.(true);
}
