// Live prices: FX + gold straight from public APIs; Taiwan stock closes from data/prices.json
// (refreshed daily by a GitHub Action because TWSE does not allow browser requests).
import * as S from "./store.js";

const HOUR = 3600e3;

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}

export async function refresh(force = false) {
  const st = S.get();
  const old = st.prices || {};
  if (!force && old.at && Date.now() - old.at < 6 * HOUR) return old;
  const p = { ...old, at: Date.now(), errors: [] };
  await Promise.all([
    getJSON("https://open.er-api.com/v6/latest/TWD").then(d => {
      p.USD = 1 / d.rates.USD; p.JPY = 1 / d.rates.JPY;
    }).catch(e => p.errors.push("匯率")),
    getJSON("https://api.gold-api.com/price/XAU").then(d => { p.goldUsdOz = d.price; })
      .catch(e => p.errors.push("金價")),
    getJSON("data/prices.json").then(d => { p.stocks = d.stocks; p.stockDate = d.date; })
      .catch(e => p.errors.push("股價")),
  ]);
  if (p.goldUsdOz && p.USD) p.goldPerGram = p.goldUsdOz * p.USD / 31.1034768;
  st.prices = p;
  S.save();
  return p;
}
