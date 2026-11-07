// All data lives in this browser (localStorage); optional encrypted cloud sync is in sync.js.
// Every record has an id and `u` (last-changed time) and deletions are remembered in `del`,
// so two devices can be merged without losing anything.
const KEY = "ledger.v1";

export const DEFAULT_CATS = {
  expense: ["伙食", "日常購物", "出遊", "交通", "娛樂", "居家", "醫療", "禮物", "其他"],
  income: ["薪資", "股息", "利息", "其他"],
};

function fresh() {
  return { v: 1, cats: structuredClone(DEFAULT_CATS), txs: [], accounts: [], snapshots: {}, del: {}, metaU: 0,
    settings: { includeOwed: true, lastWho: "me" }, prices: null };
}

let state = load();
const saveHooks = new Set();
export const onSave = fn => saveHooks.add(fn);

function normalize(s) {
  return { ...fresh(), ...s, del: s.del || {}, settings: { ...fresh().settings, ...(s.settings || {}) } };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) return normalize(s);
  } catch (e) { /* corrupted: start over */ }
  return fresh();
}

export const get = () => state;
export function save({ silent = false } = {}) {
  localStorage.setItem(KEY, JSON.stringify(state));
  if (!silent) saveHooks.forEach(f => f());
}
export function replace(s, opts) { state = normalize(s); save(opts); }

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const now = () => Date.now();

export function addTx(tx) { state.txs.push({ id: uid(), ...tx, u: now() }); sortTxs(); save(); }
export function addTxs(list) { for (const tx of list) state.txs.push({ id: uid(), ...tx, u: now() }); sortTxs(); save(); }
export function updateTx(id, patch) { Object.assign(state.txs.find(t => t.id === id), patch, { u: now() }); sortTxs(); save(); }
export function deleteTx(id) { state.txs = state.txs.filter(t => t.id !== id); state.del[id] = now(); save(); }
function sortTxs() { state.txs.sort((a, b) => (b.date + (b.ts || "")).localeCompare(a.date + (a.ts || ""))); }

export function upsertAccount(a) {
  const cur = a.id && state.accounts.find(x => x.id === a.id);
  if (cur) Object.assign(cur, a, { u: now() }); else state.accounts.push({ ...a, id: a.id || uid(), u: now() });
  save();
}
export function deleteAccount(id) { state.accounts = state.accounts.filter(x => x.id !== id); state.del[id] = now(); save(); }

// categories / settings changed
export function touchMeta() { state.metaU = now(); save(); }

export function exportJSON() { const { prices, ...rest } = state; return JSON.stringify(rest, null, 1); }

// Setup links (#/setup?d=...) carry accounts + categories without putting them in the public repo.
export function encodeSetup(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
export function decodeSetup(s) { return JSON.parse(decodeURIComponent(escape(atob(s)))); }

export function applySetup(setup) {
  if (setup.cats) {
    for (const k of ["expense", "income"]) {
      for (const c of setup.cats[k] || []) if (!state.cats[k].includes(c)) state.cats[k].push(c);
    }
    state.metaU = now();
  }
  for (const a of setup.accounts || []) {
    if (state.accounts.some(x => x.name === a.name)) continue;
    state.accounts.push({ id: uid(), group: "asset", kind: "twd", amount: 0, ...a, u: now() });
  }
  save();
}
