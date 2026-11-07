"""Browser tests (headless Chromium via Playwright).

Start a server first:  python3 -m http.server 8766
Then:                  python3 tests/run_tests.py
Screenshots go to tests/out/.
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8766/"
OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

UNIT = r"""
async () => {
  const C = await import('/js/calc.js');
  const V = await import('/js/csv.js');
  const S = await import('/js/store.js');
  const fails = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
  const txs = [
    { date: '2026-11-01', type: 'expense', amount: 1000, who: 'both', cat: '伙食' },
    { date: '2026-11-02', type: 'expense', amount: 300, who: 'her', cat: '日常購物' },
    { date: '2026-11-03', type: 'expense', amount: 250, who: 'me', cat: '交通' },
    { date: '2026-11-04', type: 'repay', amount: 200, who: 'me', cat: '還款' },
    { date: '2026-11-05', type: 'income', amount: 50000, who: 'me', cat: '薪資' },
    { date: '2026-10-30', type: 'expense', amount: 101, who: 'both', cat: '出遊' },
  ];
  eq('myShare both', C.myShare(txs[0]), 500);
  eq('herShare odd', C.herShare(txs[5]), 50.5);
  eq('owed', C.herOwed(txs), 650.5);
  const s = C.monthSummary(txs, '2026-11');
  eq('mine', s.mine, 750); eq('hers', s.hers, 800); eq('income', s.income, 50000); eq('saved', s.saved, 49250);
  eq('paid', s.paid, 1550); eq('repaid', s.repaid, 200);
  eq('byCat', s.byCat, [['伙食', 500], ['交通', 250]]);
  const prices = { USD: 30, JPY: 0.2, goldPerGram: 4000, stocks: { '0050': { c: 100 }, '2330': { c: 1000 } } };
  eq('usd', C.accountValue({ kind: 'usd', amount: 100 }, prices), 3000);
  eq('jpy', C.accountValue({ kind: 'jpy', amount: 10000 }, prices), 2000);
  eq('stock', C.accountValue({ kind: 'stock', amount: 500, holdings: [{ code: '0050', shares: 10 }, { code: '2330', shares: 1 }] }, prices), 2500);
  eq('gold cost', C.accountValue({ kind: 'gold', cost: 97624 }, prices), 97624);
  eq('gold grams', C.accountValue({ kind: 'gold', cost: 97624, grams: 30 }, prices), 120000);
  eq('usd no price', C.accountValue({ kind: 'usd', amount: 1 }, {}), null);
  const t = C.assetTotals([{ name: 'a', kind: 'twd', amount: 1000 }, { name: 'b', group: 'others', kind: 'twd', amount: 300 }], prices, 50);
  eq('totals', [t.total, t.others, t.real], [1000, 300, 750]);
  eq('totals no owed', C.assetTotals([{ name: 'a', kind: 'twd', amount: 1000 }], prices, 50, false).real, 1000);
  // csv
  eq('csv quotes', V.parseCSV('a,b\n"1,000","x""y"\n'), [['a', 'b'], ['1,000', 'x"y']]);
  eq('date slash', V.parseDate('2026/1/5 12:00'), '2026-01-05');
  eq('date zh', V.parseDate('2026年11月7日'), '2026-11-07');
  eq('amount neg', V.parseAmount('-1,200'), -1200);
  eq('who', [V.whoFrom('一起'), V.whoFrom('女友'), V.whoFrom(''), V.whoFrom('', 'both')], ['both', 'her', 'me', 'both']);
  const rows = V.parseCSV('日期,類別,金額,備註,誰\n2026/11/01,伙食,-200,午餐,一起\n2026/11/02,薪資,50000,,\nbad,x,1,,\n');
  const map = V.guessColumns(rows[0]);
  eq('guess', map, { date: 0, amount: 2, cat: 1, note: 3, who: 4 });
  const r = V.toTxs(rows.slice(1), map, { incomeCats: ['薪資'] });
  eq('import', r.txs.map(x => [x.type, x.who, x.amount]), [['expense', 'both', 200], ['income', 'me', 50000]]);
  eq('skipped', r.skipped, [4]);
  // setup link roundtrip
  eq('setup', S.decodeSetup(S.encodeSetup({ accounts: [{ name: '台銀' }] })), { accounts: [{ name: '台銀' }] });
  return fails;
}
"""


def main():
    fails = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        # keep tests offline from the price APIs
        ctx.route("https://open.er-api.com/**", lambda r: r.fulfill(json={"rates": {"USD": 1 / 32, "JPY": 5}}))
        ctx.route("https://api.gold-api.com/**", lambda r: r.fulfill(json={"price": 4000}))
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(BASE)
        fails += page.evaluate(UNIT)

        # --- end to end ---
        page.evaluate("localStorage.clear()")
        page.goto(BASE + "#/")
        page.fill("#amt", "1000")
        page.click("[data-k=who] [data-v=both]")
        page.click("[data-k=cat] [data-v=伙食]")
        page.click("#save")
        page.fill("#amt", "300")
        page.click("[data-k=who] [data-v=her]")
        page.click("#save")
        page.click("[data-k=type] [data-v=repay]")
        page.fill("#amt", "200")
        page.click("#save")
        page.click("[data-k=type] [data-v=income]")
        page.fill("#amt", "50000")
        page.click("[data-k=cat] [data-v=薪資]")
        page.click("#save")
        txt = page.inner_text(".stats")
        if "NT$600" not in txt or "NT$500" not in txt or "NT$50,000" not in txt:
            fails.append("home stats wrong: " + txt.replace("\n", " "))
        page.screenshot(path=str(OUT / "home.png"), full_page=True)

        # edit a record: change the 300 to 400
        page.click(".tx:has-text('-300')")
        page.fill(".modal #amt", "400")
        page.click(".modal #ok")
        if "NT$700" not in page.inner_text(".stats"):
            fails.append("edit did not update owed")

        page.goto(BASE + "#/report")
        page.wait_for_selector(".bar")
        page.screenshot(path=str(OUT / "report.png"), full_page=True)
        page.goto(BASE + "#/list")
        page.click("[data-f=both]")
        if page.locator(".tx").count() != 1:
            fails.append("list filter both")

        # setup link with accounts
        setup = page.evaluate("""async () => { const S = await import('/js/store.js'); return S.encodeSetup({accounts: [
          {name:'美金', kind:'usd', amount:100}, {name:'台銀', kind:'twd', amount:10000},
          {name:'台股', kind:'stock', holdings:[{code:'0050', shares:10}]}, {name:'黃金', kind:'gold', cost:97624},
          {name:'貸款', group:'others', kind:'twd', amount:5000}]}); }""")
        page.goto(BASE + "#/setup?d=" + setup)
        page.wait_for_selector(".acct")
        page.wait_for_timeout(800)
        st = page.inner_text(".stats")
        # 3200 + 10000 + 0050 close*10 + 97624 ; real = total - 5000 + 700
        price0050 = page.evaluate("fetch('/data/prices.json').then(r=>r.json()).then(d=>d.stocks['0050'].c)")
        total = 3200 + 10000 + price0050 * 10 + 97624
        want_total = f"NT${round(total):,}"
        want_real = f"NT${round(total - 5000 + 700):,}"
        if want_total not in st or want_real not in st:
            fails.append(f"assets wrong: {st!r} want {want_total} / {want_real}")
        page.screenshot(path=str(OUT / "assets.png"), full_page=True)
        # edit account
        page.click(".acct:has-text('台銀')")
        page.fill(".modal #aa", "20000")
        page.click(".modal #ok")
        if f"NT${round(total + 10000):,}" not in page.inner_text(".stats"):
            fails.append("account edit")

        # CSV import
        page.goto(BASE + "#/settings")
        csv = "日期,類別,金額,備註,誰\n2026/10/01,伙食,-200,x,一起\n2026/10/02,寵物,-99,,\n"
        page.set_input_files("#csv", files=[{"name": "a.csv", "mimeType": "text/csv", "buffer": csv.encode()}])
        page.wait_for_selector(".modal #go")
        page.screenshot(path=str(OUT / "import.png"))
        page.click(".modal #go")
        n = page.evaluate("JSON.parse(localStorage['ledger.v1']).txs.length")
        if n != 6:
            fails.append(f"csv import count {n}")
        if "寵物" not in page.inner_text("#view"):
            fails.append("new category from csv not added")
        page.screenshot(path=str(OUT / "settings.png"), full_page=True)
        if errs:
            fails.append("page errors: " + "; ".join(errs))
        b.close()
    for f in fails:
        print("FAIL", f)
    print("OK" if not fails else f"{len(fails)} failures")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
