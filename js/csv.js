// CSV import (Google Sheets "Download as CSV", or a phone app's CSV export).

export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

const HINTS = {
  date: /日期|date|時間|time/i,
  amount: /金額|amount|價格|花費|錢/i,
  cat: /類別|分類|category|項目/i,
  note: /備註|說明|note|描述|名稱|memo/i,
  type: /收支|類型|type|收入\/支出/i,
  who: /歸屬|誰|分攤|對象|成員|who/i,
};

export function guessColumns(header) {
  const map = {};
  for (const [k, re] of Object.entries(HINTS)) {
    const i = header.findIndex((h, idx) => re.test(h) && !Object.values(map).includes(idx));
    if (i >= 0) map[k] = i;
  }
  return map;
}

export function parseDate(s) {
  s = String(s || "").trim();
  let m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/); // MM/DD/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export function parseAmount(s) {
  const neg = /^\s*[-−(]/.test(String(s));
  const n = parseFloat(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export function whoFrom(s, fallback = "me") {
  s = String(s || "");
  if (/一起|共同|兩人|分攤|both/i.test(s)) return "both";
  if (/她|女友|老婆|her/i.test(s)) return "her";
  if (/我|自己|me/i.test(s)) return "me";
  return fallback;
}

// rows: data rows (header removed). map: {date, amount, cat, note, type, who} column indexes.
export function toTxs(rows, map, { defaultWho = "me", incomeCats = [] } = {}) {
  const out = [], skipped = [];
  rows.forEach((r, i) => {
    const date = parseDate(r[map.date]);
    let amount = parseAmount(r[map.amount]);
    if (!date || amount === null || amount === 0) { skipped.push(i + 2); return; }
    const cat = (map.cat !== undefined ? r[map.cat] : "").trim() || "其他";
    const typeCell = map.type !== undefined ? r[map.type] : "";
    let type = "expense";
    if (/收入|income/i.test(typeCell) || incomeCats.includes(cat)) type = "income";
    else if (/還款|還錢|repay/i.test(typeCell)) type = "repay";
    else if (!typeCell && amount > 0 && map.type === undefined && /收入/.test(cat)) type = "income";
    amount = Math.abs(amount);
    out.push({
      date, amount, cat, type,
      note: map.note !== undefined ? (r[map.note] || "").trim() : "",
      who: type === "expense" ? whoFrom(map.who !== undefined ? r[map.who] : "", defaultWho) : "me",
    });
  });
  return { txs: out, skipped };
}
