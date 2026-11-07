// Cloud sync: the whole ledger is encrypted on the device (password never leaves it) and stored as one file
// in a private GitHub repo. Two devices are merged record-by-record, so nothing is lost.
import * as S from "./store.js";

const CFG = "ledger.sync";
const API = "https://api.github.com";
export const DEFAULT_REPO = "NTCloudy/my-ledger-data";
const PATH = "ledger.enc.json";

export const config = () => { try { return JSON.parse(localStorage.getItem(CFG)) || null; } catch { return null; } };
const setConfig = c => c ? localStorage.setItem(CFG, JSON.stringify(c)) : localStorage.removeItem(CFG);

// ---------- crypto ----------
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = buf => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function keyFrom(pass, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

export async function encrypt(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const zipped = await pipe(enc.encode(JSON.stringify(obj)), new CompressionStream("gzip"));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(pass, salt), zipped);
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(data), at: new Date().toISOString() };
}

export async function decrypt(file, pass) {
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(file.iv) }, await keyFrom(pass, unb64(file.salt)), unb64(file.data));
  } catch { throw new Error("密碼不對"); }
  return JSON.parse(dec.decode(await pipe(new Uint8Array(plain), new DecompressionStream("gzip"))));
}

// ---------- merge ----------
function mergeList(a = [], b = [], del) {
  const m = new Map();
  for (const x of [...a, ...b]) {
    const cur = m.get(x.id);
    if (!cur || (x.u || 0) > (cur.u || 0)) m.set(x.id, x);
  }
  return [...m.values()].filter(x => !(del[x.id] && del[x.id] >= (x.u || 0)));
}

export function merge(local, remote) {
  if (!remote) return local;
  const del = { ...remote.del };
  for (const [k, t] of Object.entries(local.del || {})) del[k] = Math.max(t, del[k] || 0);
  const newerMeta = (remote.metaU || 0) > (local.metaU || 0) ? remote : local;
  const out = {
    ...local,
    del,
    txs: mergeList(local.txs, remote.txs, del).sort((x, y) => (y.date + (y.ts || "")).localeCompare(x.date + (x.ts || ""))),
    accounts: mergeList(local.accounts, remote.accounts, del),
    snapshots: { ...remote.snapshots, ...local.snapshots },
    cats: newerMeta.cats, metaU: newerMeta.metaU || 0,
    settings: { ...local.settings, includeOwed: newerMeta.settings ? newerMeta.settings.includeOwed : local.settings.includeOwed },
  };
  // same account created on two devices (e.g. setup link opened on both): keep the newer one
  const byName = new Map();
  for (const a of out.accounts) { const c = byName.get(a.name); if (!c || (a.u || 0) > (c.u || 0)) byName.set(a.name, a); }
  out.accounts = out.accounts.filter(a => byName.get(a.name) === a);
  // keep accounts in the order the newer side had them
  const order = (newerMeta.accounts || []).map(x => x.id);
  out.accounts.sort((x, y) => ((order.indexOf(x.id) + 1) || 1e9) - ((order.indexOf(y.id) + 1) || 1e9));
  return out;
}

// what gets uploaded (device-only things stay local)
const portable = s => { const { prices, ...rest } = s; return { ...rest, settings: { includeOwed: s.settings.includeOwed } }; };

// ---------- GitHub ----------
async function gh(cfg, path, opts = {}) {
  const r = await fetch(API + path, { ...opts, cache: "no-store", headers: {
    Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) } });
  if (r.status === 401) throw new Error("金鑰無效或過期（複製時可能少了字）");
  if (r.status === 404 && path.endsWith("/" + cfg.repo)) throw new Error("金鑰沒有選到 my-ledger-data 倉庫（Repository access 要選它）");
  if (r.status === 403) {
    const body = await r.clone().json().catch(() => ({}));
    if (/rate limit/i.test(body.message || "")) throw new Error("GitHub 暫時限流，等幾分鐘再試");
    throw new Error(opts.method === "PUT" ? "金鑰只有讀取權限：Contents 要改成 Read and write" : "金鑰沒開 Contents 權限：Contents 要改成 Read and write");
  }
  return r;
}

async function pull(cfg) {
  const r = await gh(cfg, `/repos/${cfg.repo}/contents/${PATH}`);
  if (r.status === 404) return { sha: null, data: null };
  if (!r.ok) throw new Error("讀取失敗 " + r.status);
  const j = await r.json();
  let text = j.content ? dec.decode(unb64(j.content.replace(/\n/g, ""))) : null;
  if (!text) { // > 1 MB: fetch the blob instead
    const br = await gh(cfg, `/repos/${cfg.repo}/git/blobs/${j.sha}`);
    text = dec.decode(unb64((await br.json()).content.replace(/\n/g, "")));
  }
  return { sha: j.sha, data: await decrypt(JSON.parse(text), cfg.pass) };
}

async function push(cfg, obj, sha) {
  const file = await encrypt(portable(obj), cfg.pass);
  const r = await gh(cfg, `/repos/${cfg.repo}/contents/${PATH}`, { method: "PUT", body: JSON.stringify({
    message: "sync " + file.at, content: b64(enc.encode(JSON.stringify(file))), ...(sha ? { sha } : {}) }) });
  if (r.status === 409 || r.status === 422) return false; // someone else wrote first: pull again
  if (!r.ok) throw new Error("上傳失敗 " + r.status);
  return true;
}

const same = (a, b) => JSON.stringify(portable(a)) === JSON.stringify(portable(b));

let running = null, again = false;
export const status = { state: "off", at: null, error: null };
const listeners = new Set();
export const onStatus = fn => listeners.add(fn);
const emit = (state, error = null) => { status.state = state; status.error = error; if (state === "ok") status.at = new Date(); listeners.forEach(f => f(status)); };

export async function syncNow() {
  const cfg = config();
  if (!cfg) return emit("off");
  if (running) { again = true; return running; }
  running = (async () => {
    emit("busy");
    try {
      for (let i = 0; i < 4; i++) {
        const { sha, data } = await pull(cfg);
        const merged = merge(S.get(), data);
        if (!same(merged, S.get())) S.replace(merged, { silent: true });
        if (data && same(merged, data)) break;
        if (await push(cfg, merged, sha)) break;
      }
      emit("ok");
    } catch (e) {
      emit("error", navigator.onLine === false ? "離線中，連上網路後會自動同步" : e.message);
    } finally {
      running = null;
      if (again) { again = false; syncNow(); }
    }
  })();
  return running;
}

let timer;
export function scheduleSync() { if (config()) { clearTimeout(timer); timer = setTimeout(syncNow, 2500); } }

// First-time connect: checks the key + password before saving them on this device.
export async function connect({ token, pass, repo = DEFAULT_REPO }) {
  const cfg = { token: token.trim(), pass, repo };
  const r = await gh(cfg, `/repos/${repo}`);
  if (!r.ok) throw new Error("找不到倉庫或金鑰沒權限");
  const { data } = await pull(cfg); // throws "密碼不對" when the cloud copy uses another password
  setConfig(cfg);
  await syncNow();
  return { existed: !!data };
}

export function disconnect() { setConfig(null); emit("off"); }

export function init() {
  S.onSave(scheduleSync);
  if (!config()) return emit("off");
  syncNow();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  window.addEventListener("online", () => syncNow());
}
