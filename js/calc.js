// Pure money logic (no DOM). Amounts are in TWD unless noted.

export const WHO = { me: "我", both: "一起", her: "她" };

const round = n => Math.round(n * 100) / 100;

// How much of an expense is mine / hers. "一起" is split half-half.
export function myShare(tx) {
  if (tx.type !== "expense") return 0;
  if (tx.who === "both") return round(tx.amount / 2);
  if (tx.who === "her") return 0;
  return tx.amount;
}

export function herShare(tx) {
  if (tx.type !== "expense") return 0;
  if (tx.who === "both") return round(tx.amount - tx.amount / 2);
  if (tx.who === "her") return tx.amount;
  return 0;
}

// What she still owes me: her share of everything I paid, minus what she paid back.
export function herOwed(txs) {
  let owed = 0;
  for (const t of txs) {
    owed += herShare(t);
    if (t.type === "repay") owed -= t.amount;
  }
  return round(owed);
}

export const monthOf = date => String(date).slice(0, 7);

export function monthSummary(txs, month) {
  const list = txs.filter(t => monthOf(t.date) === month);
  const byCat = {}, herByCat = {}, incomeByCat = {};
  let mine = 0, hers = 0, income = 0, repaid = 0, paid = 0;
  for (const t of list) {
    if (t.type === "expense") {
      const m = myShare(t), h = herShare(t);
      mine += m; hers += h; paid += t.amount;
      if (m) byCat[t.cat] = (byCat[t.cat] || 0) + m;
      if (h) herByCat[t.cat] = (herByCat[t.cat] || 0) + h;
    } else if (t.type === "income") {
      income += t.amount;
      incomeByCat[t.cat] = (incomeByCat[t.cat] || 0) + t.amount;
    } else if (t.type === "repay") {
      repaid += t.amount;
    }
  }
  return {
    month, count: list.length,
    mine: round(mine), hers: round(hers), paid: round(paid), income: round(income), repaid: round(repaid),
    saved: round(income - mine),
    byCat: sortDesc(byCat), herByCat: sortDesc(herByCat), incomeByCat: sortDesc(incomeByCat),
  };
}

const sortDesc = o => Object.entries(o).map(([k, v]) => [k, round(v)]).sort((a, b) => b[1] - a[1]);

// ---- assets ----
// prices: { USD: twdPerUsd, JPY: twdPerJpy, goldPerGram: twd, stocks: { code: {n, c} } }
export const OZ = 31.1034768;

export function accountValue(a, prices = {}) {
  const amt = Number(a.amount) || 0;
  switch (a.kind) {
    case "usd": return prices.USD ? round(amt * prices.USD) : null;
    case "jpy": return prices.JPY ? round(amt * prices.JPY) : null;
    case "stock": {
      let sum = 0, missing = false;
      for (const h of a.holdings || []) {
        const p = prices.stocks && prices.stocks[String(h.code).toUpperCase()];
        if (!p) { missing = true; continue; }
        sum += p.c * (Number(h.shares) || 0);
      }
      sum += amt; // cash left in the brokerage account
      return missing && !sum ? null : round(sum);
    }
    case "gold":
      if (a.grams && prices.goldPerGram) return round(a.grams * prices.goldPerGram);
      return Number(a.cost) || 0; // no weight given: count it at cost
    default: return amt;
  }
}

export function assetTotals(accounts, prices, owed = 0, includeOwed = true) {
  let total = 0, others = 0, unknown = [];
  const rows = accounts.map(a => {
    const v = accountValue(a, prices);
    if (v === null) unknown.push(a.name);
    if (a.group === "others") others += v || 0; else total += v || 0;
    return { ...a, value: v };
  });
  const real = total - others + (includeOwed ? owed : 0);
  return { rows, total: round(total), others: round(others), real: round(real), unknown };
}

export const fmt = n => n === null || n === undefined || Number.isNaN(n) ? "—"
  : (n < 0 ? "-" : "") + "NT$" + Math.round(Math.abs(n)).toLocaleString("en-US");

export const fmtCur = (n, kind) => {
  const v = Number(n) || 0;
  if (kind === "usd") return "US$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (kind === "jpy") return "¥" + Math.round(v).toLocaleString("en-US");
  return fmt(v);
};
