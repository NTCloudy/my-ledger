# 記帳

個人記帳 PWA：每筆分「我 / 一起（對半）/ 她」，自動算她欠多少；資產頁自動換算美金、日幣、台股、黃金，扣掉「不是我的錢」得到實際資產。

- 資料只存在瀏覽器 localStorage，設定頁可下載/還原備份。
- 台股收盤價由 `.github/workflows/prices.yml` 每個交易日更新到 `data/prices.json`。
- 測試：`python3 -m http.server 8766` 後跑 `python3 tests/run_tests.py`。
