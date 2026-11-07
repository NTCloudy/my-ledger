import * as S from "./store.js";
import * as C from "./calc.js";
import * as P from "./prices.js";
import * as CSV from "./csv.js";
import * as Y from "./sync.js";

const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const thisMonth = () => today().slice(0, 7);
const TYPE = { expense: "支出", income: "收入", repay: "她還錢" };
// Settings-app style icons per category
const ICONS = {
  伙食: ["🍜", "#ff9500"], 餐飲: ["🍜", "#ff9500"], 日常購物: ["🛍️", "#ff2d55"], 購物: ["🛍️", "#ff2d55"], 出遊: ["✈️", "#007aff"],
  旅遊: ["✈️", "#007aff"], 交通: ["🚇", "#30b0c7"], 娛樂: ["🎬", "#af52de"], 居家: ["🏠", "#a2845e"], 醫療: ["💊", "#ff3b30"],
  禮物: ["🎁", "#ff375f"], 寵物: ["🐾", "#a2845e"], 其他: ["•••", "#8e8e93"], 薪資: ["💼", "#34c759"], 股息: ["📈", "#34c759"],
  利息: ["🏦", "#30b0c7"], 還款: ["↩️", "#ff9500"], 收入: ["💰", "#34c759"],
};
const PALETTE = ["#5856d6", "#ff9500", "#30b0c7", "#ff2d55", "#34c759", "#af52de", "#a2845e", "#007aff"];
function icon(cat) {
  const hit = ICONS[cat] || Object.entries(ICONS).find(([k]) => String(cat).includes(k))?.[1];
  if (hit) return hit;
  let h = 0; for (const ch of String(cat)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return [esc(String(cat).slice(0, 1)), PALETTE[h % PALETTE.length]];
}
const ic = (cat, cls = "ic") => { const [e, c] = icon(cat); return `<span class="${cls}" style="background:${c}">${e}</span>`; };
const num = n => C.fmt(n).replace("NT$", "");
const title = (t, extra = "") => `<h1 class="title">${t}</h1>${extra}`;
const KIND = { twd: "台幣", usd: "美金", jpy: "日幣", stock: "股票", gold: "黃金" };

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 1800);
}

function shiftMonth(m, d) {
  const [y, mo] = m.split("-").map(Number);
  const dt = new Date(y, mo - 1 + d, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
const monthLabel = m => `${m.slice(0, 4)} 年 ${Number(m.slice(5))} 月`;
const monthPicker = (m, id) => `<div class="monthbar"><button data-m="${shiftMonth(m, -1)}" data-for="${id}">‹</button>
  <b>${monthLabel(m)}</b><button data-m="${shiftMonth(m, 1)}" data-for="${id}">›</button></div>`;
const viewMonth = {};

// ---------- modal ----------
function modal(html, onMount) {
  const wrap = document.createElement("div");
  wrap.className = "modal";
  wrap.innerHTML = `<div class="sheet">${html}</div>`;
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
  function close() { wrap.remove(); }
  onMount && onMount(wrap.firstChild, close);
  return close;
}

// ---------- entry form (used by home + edit) ----------
function formHTML(tx) {
  const st = S.get();
  const cats = st.cats[tx.type === "income" ? "income" : "expense"];
  return `
  <div class="seg" data-k="type">${Object.entries(TYPE).map(([k, v]) =>
    `<button class="${tx.type === k ? "on" : ""}" data-v="${k}">${v}</button>`).join("")}</div>
  <div class="amount-wrap"><span class="cur">NT$</span><input id="amt" class="amount" inputmode="decimal" placeholder="0" value="${tx.amount || ""}" autocomplete="off"></div>
  ${tx.type === "expense" ? `<div class="seg who" data-k="who">${Object.entries(C.WHO).map(([k, v]) =>
    `<button class="${tx.who === k ? "on" : ""}" data-v="${k}">${v}</button>`).join("")}</div>
    <p class="hint small muted">${tx.who === "both" ? "一起：一半算我、一半算她欠我" : tx.who === "her" ? "她的：全部算她欠我" : "我的：全部算我"}</p>` : ""}
  ${tx.type !== "repay" ? `<div class="catgrid" data-k="cat">${cats.map(c =>
    `<button class="${tx.cat === c ? "on" : ""}" data-v="${esc(c)}">${ic(c)}<span>${esc(c)}</span></button>`).join("")}</div>` : ""}
  <div class="fields"><input id="date" type="date" value="${tx.date}"><input id="note" placeholder="備註" value="${esc(tx.note || "")}"></div>`;
}

function fitAmount(root) {
  const a = $("#amt", root); if (!a) return;
  const fit = () => { a.style.width = Math.max(1, a.value.length || 1) + 0.6 + "ch"; };
  a.addEventListener("input", fit); fit();
}

function bindForm(root, tx, rerender) {
  root.addEventListener("click", e => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    const k = b.parentElement.dataset.k;
    collect(root, tx);
    tx[k] = b.dataset.v;
    if (k === "type") {
      const cats = S.get().cats[tx.type === "income" ? "income" : "expense"];
      if (!cats.includes(tx.cat)) tx.cat = cats[0];
    }
    if (k === "who") S.get().settings.lastWho = tx.who;
    rerender();
  });
}

function collect(root, tx) {
  const a = $("#amt", root); if (a) tx.amount = a.value;
  const d = $("#date", root); if (d) tx.date = d.value;
  const n = $("#note", root); if (n) tx.note = n.value;
}

function validTx(tx) {
  const amount = parseFloat(String(tx.amount).replace(/,/g, ""));
  if (!(amount > 0)) { toast("請輸入金額"); return null; }
  if (!tx.date) { toast("請選日期"); return null; }
  return { date: tx.date, type: tx.type, amount, who: tx.type === "expense" ? tx.who : "me",
    cat: tx.type === "repay" ? "還款" : tx.cat, note: (tx.note || "").trim() };
}

const newTx = () => ({ type: "expense", who: S.get().settings.lastWho || "me", cat: S.get().cats.expense[0], amount: "", date: today(), note: "" });
let draft = null;

// ---------- views ----------
function home() {
  const st = S.get();
  draft = draft || newTx();
  const sum = C.monthSummary(st.txs, thisMonth());
  const owed = C.herOwed(st.txs);
  view.innerHTML = `${title("記一筆")}
    <section class="card" id="form">${formHTML(draft)}<button class="primary big" id="save">記下來</button></section>
    <section class="stats">
      <div><span>本月支出</span><b>${num(sum.mine)}</b></div>
      <div><span>本月收入</span><b class="ok">${num(sum.income)}</b></div>
      <div><span>她欠我</span><b class="${owed > 0 ? "warn" : ""}">${num(owed)}</b></div>
    </section>
    ${txList(st.txs.slice(0, 8))}`;
  const form = $("#form");
  bindForm(form, draft, home);
  fitAmount(form);
  $("#save").onclick = () => {
    collect(form, draft);
    const tx = validTx(draft); if (!tx) return;
    tx.ts = new Date().toISOString();
    S.addTx(tx);
    toast(`已記：${TYPE[tx.type]} ${C.fmt(tx.amount)}`);
    draft = { ...newTx(), type: tx.type, cat: tx.cat, who: tx.who, date: tx.date };
    home();
    $("#amt").focus();
  };
  $("#amt").addEventListener("keydown", e => { if (e.key === "Enter") $("#save").click(); });
}

function txList(txs) {
  if (!txs.length) return `<div class="list"><div class="empty">還沒有紀錄</div></div>`;
  let last = "", out = "";
  for (const t of txs) {
    if (t.date !== last) { out += `<div class="day">${dayLabel(t.date)}</div>`; last = t.date; }
    const sign = t.type === "expense" ? "-" : "+";
    const badge = t.type === "expense" && t.who !== "me" ? `<span class="badge ${t.who}">${C.WHO[t.who]}</span>` : "";
    const name = t.type === "repay" ? "她還錢" : esc(t.cat);
    out += `<div class="tx" data-id="${t.id}">${ic(t.type === "repay" ? "還款" : t.cat)}<div class="grow"><div>${name}${badge}</div>${t.note ? `<div class="small muted">${esc(t.note)}</div>` : ""}</div>
      <b class="${t.type === "expense" ? "" : "ok"}">${sign}${C.fmt(t.amount).replace("NT$", "")}</b></div>`;
  }
  return `<div class="list days">${out}</div>`;
}

function dayLabel(d) {
  const t = today(), y = new Date(Date.now() - 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const wd = "日一二三四五六"[new Date(d + "T00:00").getDay()];
  return d === t ? "今天" : d === y ? "昨天" : `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日 週${wd}`;
}

function editTx(id, after) {
  const orig = S.get().txs.find(t => t.id === id); if (!orig) return;
  const tx = { ...orig };
  modal(`<h3>修改紀錄</h3><div id="ef"></div><div class="row"><button class="danger" id="del">刪除</button><button class="primary grow" id="ok">儲存</button></div>`,
    (sheet, close) => {
      const ef = $("#ef", sheet);
      const draw = () => { ef.innerHTML = formHTML(tx); fitAmount(ef); };
      draw();
      bindForm(ef, tx, draw);
      $("#ok", sheet).onclick = () => { collect(ef, tx); const v = validTx(tx); if (!v) return; S.updateTx(id, v); close(); after(); toast("已更新"); };
      $("#del", sheet).onclick = () => { if (confirm("確定刪除這筆？")) { S.deleteTx(id); close(); after(); toast("已刪除"); } };
    });
}

let listFilter = "all";
function list() {
  const st = S.get();
  const m = viewMonth.list || thisMonth();
  let txs = st.txs.filter(t => C.monthOf(t.date) === m);
  if (listFilter !== "all") txs = txs.filter(t => listFilter === "income" ? t.type !== "expense" : t.type === "expense" && t.who === listFilter);
  const fl = { all: "全部", me: "我", both: "一起", her: "她", income: "收入/還款" };
  view.innerHTML = `${title("明細")}${monthPicker(m, "list")}
    <div class="chips filter">${Object.entries(fl).map(([k, v]) => `<button data-f="${k}" class="${listFilter === k ? "on" : ""}">${v}</button>`).join("")}</div>
    <p class="section-f" style="margin:10px 4px 0">${txs.length} 筆・合計 ${C.fmt(txs.reduce((s, t) => s + (t.type === "expense" ? -t.amount : t.amount), 0))}</p>
    ${txList(txs)}`;
}

function legend(rows, total) {
  if (!rows.length) return `<div class="list"><div class="empty">沒有資料</div></div>`;
  return `<div class="list legend">${rows.map(([k, v]) => { const c = icon(k)[1]; return `<div class="cell">${ic(k)}
    <div class="grow"><div>${esc(k)}</div><div class="meter"><i style="width:${total ? Math.max(2, v / total * 100) : 0}%;background:${c}"></i></div></div>
    <b style="font-weight:400">${C.fmt(v)}</b><span class="pct">${total ? Math.round(v / total * 100) : 0}%</span></div>`; }).join("")}</div>`;
}

function donut(rows, total, label) {
  const R = 52, L = 2 * Math.PI * R; let off = 0;
  const arcs = total ? rows.map(([k, v]) => { const len = v / total * L, gap = rows.length > 1 ? Math.min(2, len / 2) : 0;
    const a = `<circle r="${R}" cx="64" cy="64" fill="none" stroke="${icon(k)[1]}" stroke-width="16" stroke-dasharray="${len - gap} ${L}" stroke-dashoffset="${-off}"/>`;
    off += len; return a; }).join("") : "";
  return `<div class="donut"><svg viewBox="0 0 128 128"><circle r="${R}" cx="64" cy="64" fill="none" stroke="var(--fill)" stroke-width="16"/>${arcs}</svg>
    <div class="mid">${label}<b>${C.fmt(total)}</b></div></div>`;
}

function report() {
  const st = S.get();
  const m = viewMonth.report || thisMonth();
  const s = C.monthSummary(st.txs, m);
  const trend = [];
  for (let i = 5; i >= 0; i--) { const mm = shiftMonth(m, -i); trend.push(C.monthSummary(st.txs, mm)); }
  const max = Math.max(1, ...trend.map(t => Math.max(t.mine, t.income)));
  view.innerHTML = `${title("報表")}${monthPicker(m, "report")}
    <section class="stats">
      <div><span>收入</span><b class="ok">${num(s.income)}</b></div>
      <div><span>我的支出</span><b>${num(s.mine)}</b></div>
      <div><span>存下</span><b class="${s.saved >= 0 ? "ok" : "danger-t"}">${num(s.saved)}</b></div>
    </section>
    <section class="card">${donut(s.byCat, s.mine, "我的支出")}</section>
    <div class="section-h">我的支出（含一起的一半）</div>${legend(s.byCat, s.mine)}
    <div class="section-h">她的份</div>${legend(s.herByCat, s.hers)}
    <p class="section-f">卡片實際刷了 ${C.fmt(s.paid)}，其中 ${C.fmt(s.hers)} 是她的份；本月她還了 ${C.fmt(s.repaid)}。</p>
    <div class="section-h">收入</div>${legend(s.incomeByCat, s.income)}
    <div class="section-h">近 6 個月</div><section class="card" style="margin-top:0">
      <div class="trend">${trend.map(t => `<div class="col"><div class="pair">
        <i class="in" style="height:${t.income / max * 100}%;${t.income ? "" : "opacity:.25"}" title="收入 ${C.fmt(t.income)}"></i>
        <i class="out" style="height:${t.mine / max * 100}%;${t.mine ? "" : "opacity:.25"}" title="支出 ${C.fmt(t.mine)}"></i></div>
        <small>${Number(t.month.slice(5))}月</small></div>`).join("")}</div>
      <p class="small muted" style="margin:10px 0 0;text-align:center"><span class="dot in"></span>收入<span class="dot out"></span>我的支出</p></section>`;
}

async function assets() {
  const st = S.get();
  const draw = () => {
    const owed = C.herOwed(st.txs);
    const t = C.assetTotals(st.accounts, st.prices || {}, owed, st.settings.includeOwed);
    if (st.accounts.length) {
      const snap = { total: t.total, others: t.others, real: t.real };
      if (JSON.stringify(st.snapshots[thisMonth()]) !== JSON.stringify(snap)) { st.snapshots[thisMonth()] = snap; S.save(); }
    }
    const p = st.prices || {};
    const KIC = { twd: ["$", "#34c759"], usd: ["US", "#007aff"], jpy: ["¥", "#ff3b30"], stock: ["📈", "#5856d6"], gold: ["🪙", "#ffcc00"] };
    const aic = a => { const [e, c] = a.group === "others" ? ["↗", "#8e8e93"] : (KIC[a.kind] || KIC.twd); return `<span class="ic" style="background:${c};font-size:${e.length > 1 && e < "~" ? 12 : 16}px">${e}</span>`; };
    const row = a => `<div class="acct chev" data-acct="${a.id}">${aic(a)}<div class="grow"><div>${esc(a.name)}</div>
      <div class="small muted">${a.kind === "stock" ? (a.holdings || []).map(h => `${esc(h.code)}×${h.shares}`).join("、") || "未填持股"
        : a.kind === "gold" ? `成本 ${C.fmt(a.cost)}${a.grams ? `・${a.grams} 克` : ""}`
        : a.kind === "usd" || a.kind === "jpy" ? C.fmtCur(a.amount, a.kind) : ""}</div></div>
      <b>${C.fmt(a.value)}</b></div>`;
    const snaps = Object.entries(st.snapshots).sort().slice(-12);
    const smax = Math.max(1, ...snaps.map(([, v]) => Math.abs(v.real)));
    view.innerHTML = `${title("資產")}
      <section class="hero"><div class="label">實際資產</div><div class="big">${C.fmt(t.real)}</div>
        <div class="sub"><div><span>總資產</span>${C.fmt(t.total)}</div><div><span>不是我的錢</span>${C.fmt(-t.others)}</div>
        ${st.settings.includeOwed && owed ? `<div><span>她欠我</span>${C.fmt(owed)}</div>` : ""}</div></section>
      ${t.unknown.length ? `<p class="section-f warn">還沒抓到價格：${t.unknown.map(esc).join("、")}</p>` : ""}
      <div class="section-h">資產</div><div class="list">${t.rows.filter(a => a.group !== "others").map(row).join("") || `<div class="empty">還沒有帳戶</div>`}</div>
      <div class="section-h">不是我的錢</div>
      <div class="list">${t.rows.filter(a => a.group === "others").map(row).join("") || `<div class="empty">沒有</div>`}</div>
      <p class="section-f">拿來投資、之後要還的錢，會從總資產扣掉。</p>
      <button id="addAcct">新增帳戶</button>
      ${snaps.length > 1 ? `<div class="section-h">實際資產變化</div><section class="card" style="margin-top:0"><div class="trend">${snaps.map(([m, v]) =>
        `<div class="col"><div class="pair"><i class="in" style="height:${Math.abs(v.real) / smax * 100}%" title="${C.fmt(v.real)}"></i></div><small>${Number(m.slice(5))}月</small></div>`).join("")}</div></section>` : ""}
      <p class="section-f" style="text-align:center;margin-top:18px">美金 ${p.USD ? p.USD.toFixed(2) : "—"}・日幣 ${p.JPY ? p.JPY.toFixed(4) : "—"}・金價 ${p.goldPerGram ? C.fmt(p.goldPerGram) + "/克" : "—"}・股價 ${p.stockDate || "—"}
        <button class="link" id="refresh">更新價格</button></p>`;
    $("#addAcct").onclick = () => editAcct(null, draw);
    $("#refresh").onclick = async () => { toast("更新中…"); const r = await P.refresh(true); draw(); toast(r.errors.length ? "部分沒抓到：" + r.errors.join("、") : "價格已更新"); };
  };
  draw();
  const before = st.prices && st.prices.at;
  await P.refresh();
  if (location.hash.startsWith("#/assets") && (st.prices && st.prices.at) !== before) draw();
}

function editAcct(id, after) {
  const st = S.get();
  const a = id ? { ...st.accounts.find(x => x.id === id) } : { name: "", group: "asset", kind: "twd", amount: "" };
  modal(`<h3>${id ? "修改帳戶" : "新增帳戶"}</h3>
    <label>名稱<input id="an" value="${esc(a.name)}" placeholder="例如：台銀"></label>
    <div class="seg" data-k="group"><button data-v="asset">資產</button><button data-v="others">不是我的錢</button></div>
    <div class="seg" data-k="kind">${Object.entries(KIND).map(([k, v]) => `<button data-v="${k}">${v}</button>`).join("")}</div>
    <div id="kf"></div>
    <div class="row">${id ? `<button class="danger" id="del">刪除</button>` : ""}<button class="primary grow" id="ok">儲存</button></div>`,
    (sheet, close) => {
      const kf = $("#kf", sheet);
      const read = () => {
        a.name = $("#an", sheet).value.trim();
        const v = n => { const el = $("#" + n, sheet); return el ? el.value : undefined; };
        if (v("aa") !== undefined) a.amount = parseFloat(String(v("aa")).replace(/,/g, "")) || 0;
        if (v("ah") !== undefined) a.holdings = v("ah").split("\n").map(l => l.trim().split(/[\s,，×x*]+/)).filter(p => p[0])
          .map(([code, shares]) => ({ code: code.toUpperCase(), shares: parseFloat(shares) || 0 }));
        if (v("ac") !== undefined) a.cost = parseFloat(String(v("ac")).replace(/,/g, "")) || 0;
        if (v("ag") !== undefined) a.grams = parseFloat(v("ag")) || 0;
      };
      const draw = () => {
        sheet.querySelectorAll(".seg button").forEach(b => b.classList.toggle("on", a[b.parentElement.dataset.k] === b.dataset.v));
        const amtLabel = { twd: "金額（台幣）", usd: "金額（美金）", jpy: "金額（日圓）" }[a.kind];
        kf.innerHTML = a.kind === "stock"
          ? `<label>持股（一行一檔：代號 股數）<textarea id="ah" rows="4" placeholder="0050 1000&#10;2330 50">${(a.holdings || []).map(h => `${h.code} ${h.shares}`).join("\n")}</textarea></label>
             <label>帳戶裡的現金（台幣，選填）<input id="aa" inputmode="decimal" value="${a.amount || ""}"></label>`
          : a.kind === "gold"
          ? `<label>買入成本（台幣）<input id="ac" inputmode="decimal" value="${a.cost || ""}"></label>
             <label>克數（選填，填了就用即時金價估值）<input id="ag" inputmode="decimal" value="${a.grams || ""}"></label>`
          : `<label>${amtLabel}<input id="aa" inputmode="decimal" value="${a.amount ?? ""}"></label>`;
      };
      sheet.addEventListener("click", e => {
        const b = e.target.closest(".seg [data-v]"); if (!b) return;
        read(); a[b.parentElement.dataset.k] = b.dataset.v; draw();
      });
      draw();
      $("#ok", sheet).onclick = () => {
        read();
        if (!a.name) return toast("請輸入名稱");
        S.upsertAccount(a); close(); after(); toast("已儲存");
      };
      const del = $("#del", sheet);
      if (del) del.onclick = () => { if (confirm(`刪除「${a.name}」？`)) { S.deleteAccount(id); close(); after(); } };
    });
}

function settings() {
  const st = S.get();
  const catBlock = k => `<div class="list">${st.cats[k].map((c, i) => `<div class="cell" data-cat="${k}" data-i="${i}">${ic(c)}<div class="grow">${esc(c)}</div><span class="danger-t small">刪除</span></div>`).join("")}
    <div class="cell" data-addcat="${k}"><span class="ic" style="background:var(--blue)">＋</span><div class="grow" style="color:var(--blue)">新增類別</div></div></div>`;
  view.innerHTML = `${title("設定")}
    <div class="section-h">雲端同步</div><section class="card" id="sync" style="margin-top:0">${syncCard()}</section>
    <div class="section-h">計算</div>
    <div class="list"><div class="cell" style="cursor:default"><label class="toggle grow">實際資產加上她欠我的錢<input type="checkbox" id="io" ${st.settings.includeOwed ? "checked" : ""}></label></div></div>
    <div class="section-h">支出類別</div>${catBlock("expense")}
    <div class="section-h">收入類別</div>${catBlock("income")}
    <p class="section-f">刪除類別不影響舊紀錄。</p>
    <div class="section-h">資料</div>
    <div class="list">
      <label class="cell" style="margin:0;color:var(--blue);font-size:17px">匯入 CSV（Google 試算表、記帳 App）<input type="file" id="csv" accept=".csv,text/csv" hidden></label>
      <div class="cell" id="bk" style="color:var(--blue)">下載備份</div>
      <label class="cell" style="margin:0;color:var(--blue);font-size:17px">還原備份<input type="file" id="rs" accept=".json" hidden></label>
    </div>
    <p class="section-f">共 ${st.txs.length} 筆紀錄、${st.accounts.length} 個帳戶。</p>
    <div class="list" style="margin-top:28px"><div class="cell" id="wipe" style="color:var(--red);justify-content:center">清除全部資料</div></div>`;
  view.onclick = e => {
    const c = e.target.closest("[data-cat]");
    if (c) { const k = c.dataset.cat, i = +c.dataset.i; if (confirm(`刪除類別「${st.cats[k][i]}」？`)) { st.cats[k].splice(i, 1); S.touchMeta(); settings(); } return; }
    const a = e.target.closest("[data-addcat]");
    if (a) { const n = (prompt("新類別名稱") || "").trim(); if (n && !st.cats[a.dataset.addcat].includes(n)) { st.cats[a.dataset.addcat].push(n); S.touchMeta(); settings(); } }
  };
  bindSync();
  $("#io").onchange = e => { st.settings.includeOwed = e.target.checked; S.touchMeta(); };
  $("#bk").onclick = () => {
    const blob = new Blob([S.exportJSON()], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `記帳備份-${today()}.json`; link.click();
  };
  $("#rs").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const s = JSON.parse(await f.text()); if (s.v !== 1) throw 0; if (confirm("用備份取代目前所有資料？")) {
      const t = Date.now(); s.metaU = t; for (const x of [...(s.txs || []), ...(s.accounts || [])]) { x.id = x.id || S.uid(); x.u = t; }
      S.replace(s); toast("已還原"); settings(); } }
    catch { toast("檔案格式不對"); }
  };
  $("#wipe").onclick = () => { if (confirm("真的要清除全部資料？（建議先下載備份）") && confirm("再確認一次：清除後無法復原")) { localStorage.clear(); location.reload(); } };
  $("#csv").onchange = async e => { const f = e.target.files[0]; if (f) importCSV(await f.text()); e.target.value = ""; };
}

const syncText = st => st.state === "busy" ? "同步中…" : st.state === "error" ? "⚠️ " + st.error
  : st.at ? "已同步 " + st.at.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : "已連線";

function syncCard() {
  const cfg = Y.config();
  if (cfg) return `<p style="margin:0 0 6px">☁️ 已開啟・<span id="syst">${esc(syncText(Y.status))}</span></p>
    <p class="small muted">每次記帳後自動加密上傳到你的私人倉庫 ${esc(cfg.repo)}；打開 App 時自動下載合併。</p>
    <div class="row"><button class="plain" id="synow">立即同步</button><button class="plain danger" id="syoff" style="flex:1">關閉同步</button></div>`;
  return `<p class="small muted" style="margin-top:0">把資料加密存到你的 GitHub 私人倉庫，手機、電腦都能看到同一份。每台裝置設定一次。</p>
    <label>GitHub 金鑰<input id="sytk" type="password" autocomplete="off" placeholder="github_pat_…"></label>
    <label>資料密碼（每台裝置要填一樣的，忘記就解不開）<input id="sypw" type="password" autocomplete="new-password"></label>
    <button class="primary" id="syon" style="width:100%;margin-top:4px">開啟同步</button>`;
}

function bindSync() {
  const on = $("#syon");
  if (on) on.onclick = async () => {
    const token = $("#sytk").value.trim(), pass = $("#sypw").value;
    if (!token.startsWith("github_pat_") && !token.startsWith("ghp_")) return toast("金鑰格式不對");
    if (pass.length < 6) return toast("密碼至少 6 個字");
    on.disabled = true; on.textContent = "連線中…";
    try {
      const r = await Y.connect({ token, pass });
      toast(r.existed ? "已連線，雲端資料已合併進來" : "已連線，資料已上傳");
      settings();
    } catch (e) { toast(e.message); on.disabled = false; on.textContent = "開啟同步"; }
  };
  const now = $("#synow"); if (now) now.onclick = () => Y.syncNow();
  const off = $("#syoff"); if (off) off.onclick = () => { if (confirm("在這台裝置關閉同步？（資料仍留在這台和雲端）")) { Y.disconnect(); settings(); } };
}

function importCSV(text) {
  const rows = CSV.parseCSV(text);
  if (rows.length < 2) return toast("檔案是空的");
  const header = rows[0], data = rows.slice(1);
  const map = CSV.guessColumns(header);
  const fields = { date: "日期*", amount: "金額*", cat: "類別", note: "備註", type: "收入/支出", who: "誰的（我/一起/她）" };
  const opt = sel => `<option value="">（沒有）</option>` + header.map((h, i) => `<option value="${i}" ${sel === i ? "selected" : ""}>${esc(h || `第${i + 1}欄`)}</option>`).join("");
  modal(`<h3>匯入 CSV（${data.length} 列）</h3>
    <p class="small muted">對應一下欄位：</p>
    ${Object.entries(fields).map(([k, v]) => `<label class="map">${v}<select data-map="${k}">${opt(map[k])}</select></label>`).join("")}
    <label class="map">沒寫誰的就算<select id="dw"><option value="me">我</option><option value="both">一起</option><option value="her">她</option></select></label>
    <div id="pv" class="small"></div>
    <div class="row"><button id="cx">取消</button><button class="primary grow" id="go">匯入</button></div>`,
    (sheet, close) => {
      const cur = () => {
        const m = {};
        sheet.querySelectorAll("[data-map]").forEach(s => { if (s.value !== "") m[s.dataset.map] = +s.value; });
        return CSV.toTxs(data, m, { defaultWho: $("#dw", sheet).value, incomeCats: S.get().cats.income });
      };
      const preview = () => {
        const r = cur();
        $("#pv", sheet).innerHTML = `<p>可匯入 ${r.txs.length} 筆${r.skipped.length ? `，略過 ${r.skipped.length} 列（日期或金額看不懂）` : ""}</p>` +
          r.txs.slice(0, 5).map(t => `<div>${t.date}・${TYPE[t.type]}・${C.WHO[t.who]}・${esc(t.cat)}・${C.fmt(t.amount)}</div>`).join("");
      };
      sheet.addEventListener("change", preview);
      preview();
      $("#cx", sheet).onclick = close;
      $("#go", sheet).onclick = () => {
        const r = cur(); if (!r.txs.length) return toast("沒有可匯入的資料");
        const st = S.get();
        for (const t of r.txs) {
          const k = t.type === "income" ? "income" : "expense";
          if (t.type !== "repay" && !st.cats[k].includes(t.cat)) { st.cats[k].push(t.cat); st.metaU = Date.now(); }
        }
        S.addTxs(r.txs); close(); toast(`已匯入 ${r.txs.length} 筆`); settings();
      };
    });
}

function setup(q) {
  try {
    // read d= raw: URLSearchParams would turn base64 "+" into spaces
    const s = S.decodeSetup(decodeURIComponent(String(q).replace(/^.*?\bd=/, "").split("&")[0]).replace(/ /g, "+"));
    S.applySetup(s);
    toast(`已加入 ${(s.accounts || []).length} 個帳戶`);
  } catch { toast("設定連結壞了"); }
  location.replace("#/assets");
}

// ---------- router ----------
const routes = { "": home, list, report, assets, settings };
function route() {
  const [path, q] = location.hash.replace(/^#\/?/, "").split("?");
  view.onclick = null;
  if (path === "setup") return setup(q);
  (routes[path] || home)();
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("on", a.dataset.r === path));
  window.scrollTo(0, 0);
}

document.addEventListener("click", e => {
  const mb = e.target.closest(".monthbar [data-m]");
  if (mb) { viewMonth[mb.dataset.for] = mb.dataset.m; route(); return; }
  const f = e.target.closest("[data-f]");
  if (f) { listFilter = f.dataset.f; list(); return; }
  const tx = e.target.closest(".tx[data-id]");
  if (tx && !e.target.closest(".modal")) { editTx(tx.dataset.id, route); return; }
  const ac = e.target.closest(".acct[data-acct]");
  if (ac) { editAcct(ac.dataset.acct, route); }
});

window.addEventListener("hashchange", route);
route();
let lastShown = JSON.stringify(S.get().txs.length + ":" + S.get().accounts.length);
Y.onStatus(st => {
  const el = $("#cloud"); if (el) el.textContent = Y.config() ? { busy: "☁️…", ok: "☁️", error: "⚠️", off: "" }[st.state] : "";
  const sy = $("#syst"); if (sy) sy.textContent = syncText(st);
  if (st.state === "ok") {
    const sig = JSON.stringify(S.get());
    // remote changes arrived: redraw unless the user is typing
    if (sig !== lastShown && !document.querySelector(".modal") && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) route();
    lastShown = sig;
  }
});
Y.init();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
