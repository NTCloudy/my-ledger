// All data lives only in this browser (localStorage). Backup = download a JSON file.
const KEY = "ledger.v1";

export const DEFAULT_CATS = {
  expense: ["伙食", "日常購物", "出遊", "交通", "娛樂", "居家", "醫療", "禮物", "其他"],
  income: ["薪資", "股息", "利息", "其他"],
};

function fresh() {
  return { v: 1, cats: structuredClone(DEFAULT_CATS), txs: [], accounts: [], snapshots: {},
    settings: { includeOwed: true, lastWho: "me" }, prices: null };
}

let state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) return { ...fresh(), ...s, settings: { ...fresh().settings, ...s.settings } };
  } catch (e) { /* corrupted: start over */ }
  return fresh();
}

export const get = () => state;
export function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
export function replace(s) { state = { ...fresh(), ...s, settings: { ...fresh().settings, ...(s.settings || {}) } }; save(); }

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function addTx(tx) { state.txs.push({ id: uid(), ...tx }); sortTxs(); save(); }
export function updateTx(id, patch) { Object.assign(state.txs.find(t => t.id === id), patch); sortTxs(); save(); }
export function deleteTx(id) { state.txs = state.txs.filter(t => t.id !== id); save(); }
function sortTxs() { state.txs.sort((a, b) => (b.date + (b.ts || "")).localeCompare(a.date + (a.ts || ""))); }

export function exportJSON() { return JSON.stringify(state, null, 1); }

// Setup links (#/setup?d=...) carry accounts + categories without putting them in the public repo.
export function encodeSetup(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
export function decodeSetup(s) { return JSON.parse(decodeURIComponent(escape(atob(s)))); }

export function applySetup(setup) {
  if (setup.cats) {
    for (const k of ["expense", "income"]) {
      for (const c of setup.cats[k] || []) if (!state.cats[k].includes(c)) state.cats[k].push(c);
    }
  }
  for (const a of setup.accounts || []) {
    if (state.accounts.some(x => x.name === a.name)) continue;
    state.accounts.push({ id: uid(), group: "asset", kind: "twd", amount: 0, ...a });
  }
  save();
}
