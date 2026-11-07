"""Daily Taiwan stock/ETF closing prices -> data/prices.json (TWSE + TPEx open data).

The browser can't call these APIs directly (no CORS), so a GitHub Action runs this once a day.
"""

import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "prices.json"
TWSE = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
TPEX = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


# stocks (2330), ETFs (0050, 00878, 00400A), preferred shares (2881A); skips warrants
KEEP = re.compile(r"^(\d{4}|00\d{2,4}[A-Z]?|\d{4}[A-Z])$")


def num(s):
    try:
        v = float(str(s).replace(",", "").strip())
        return v if v > 0 else None
    except ValueError:
        return None


def roc_to_iso(d):
    d = str(d)
    return f"{int(d[:-4]) + 1911}-{d[-4:-2]}-{d[-2:]}" if len(d) >= 7 else None


def main():
    stocks, date, errors = {}, None, []
    try:
        for r in get(TWSE):
            c = num(r.get("ClosingPrice"))
            if c and KEEP.match(r["Code"].strip().upper()):
                stocks[r["Code"].strip().upper()] = {"n": r["Name"].strip(), "c": c}
                date = date or roc_to_iso(r.get("Date"))
    except Exception as e:  # noqa: BLE001
        errors.append(f"TWSE: {e}")
    try:
        for r in get(TPEX):
            c = num(r.get("Close"))
            code = r.get("SecuritiesCompanyCode", "").strip().upper()
            if c and KEEP.match(code) and code not in stocks:
                stocks[code] = {"n": r.get("CompanyName", "").strip(), "c": c}
    except Exception as e:  # noqa: BLE001
        errors.append(f"TPEx: {e}")
    if len(stocks) < 300:
        print("too few prices, keeping the old file:", errors, file=sys.stderr)
        sys.exit(1)
    OUT.parent.mkdir(exist_ok=True)
    now = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    OUT.write_text(json.dumps({"date": date, "updated": now, "stocks": stocks}, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(stocks)} prices, trade date {date}", errors or "")


if __name__ == "__main__":
    main()
