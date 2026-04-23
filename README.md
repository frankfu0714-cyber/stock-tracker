# Stock Tracker

A personal portfolio tracker for Taiwan (上市 / 上櫃 / **興櫃**) and US stocks.
Runs as a web app — add it to your iPhone home screen and it behaves like a native app.

**What's in here**

- `index.html` — the web app (single file, works offline once loaded)
- `api/price.js` — price lookup (Yahoo for 上市/上櫃/US, TPEx OpenAPI for 興櫃)
- `api/fx.js` — USD/TWD exchange rate
- `server.js` — local dev server
- `smoke-test.js` — sanity check for the price endpoints

---

## Quick start — run on your Mac, use from your iPhone

You need Node 18+ (`node --version`).

```bash
cd stock-tracker
npm start             # boots on http://localhost:3000
```

Open `http://localhost:3000` in Safari. Tap the **share** icon → **Add to Home Screen**.

In the app, tap ⚙ (top right) and set:

- **Price API base URL**: `http://localhost:3000` (or leave blank if you just want to enter positions manually without live prices)

To use it from your iPhone while your Mac is running, replace `localhost` with your Mac's LAN IP (System Settings → Network → your Mac's IP), e.g. `http://192.168.1.42:3000`. Mac and iPhone must be on the same Wi-Fi.

## Deploy to the internet (recommended for everyday use)

Using Vercel (free tier is plenty):

```bash
npm i -g vercel
vercel                # follow the prompts
vercel --prod
```

You'll get a URL like `https://stock-tracker-abc123.vercel.app`. Put that in the app's Settings → Price API base URL. Now it works from anywhere — no need to keep your Mac on.

---

## Features

- **Manual entry**: symbol, market, quantity, avg cost per share, account, date, notes
- **Multiple accounts**: track your three TW brokers and one US broker separately; each account shows its own P/L
- **Screenshot OCR**: tap +, choose "Upload screenshot", drop in a screenshot from your broker app. Uses Tesseract.js (Traditional Chinese + English) in the browser — nothing is uploaded. Review the parsed rows before saving.
- **Live prices** (15-20 min delayed):
  - 上市 (TWSE): Yahoo `XXXX.TW`
  - 上櫃 (OTC): Yahoo `XXXX.TWO`
  - **興櫃 (Emerging): TPEx official OpenAPI** — this is what 籌碼K線 doesn't surface cleanly
  - US: Yahoo
- **Total P/L view** in TWD or USD using live FX, or split by currency
- **Local storage only**: all holdings live in your browser/phone. No account, no cloud sync. Use Settings → Export JSON to back up.

## About the 興櫃 price source

TPEx publishes an OpenAPI endpoint (`tpex_esb_latest_statistics`) that returns the entire emerging-stock board as JSON — ~350 stocks, including `LatestPrice`, `BuyingPrice`, `SellingPrice`, `PreviousAveragePrice`, `Highest`, `Lowest`, `Volume`, `Date`, `Time`. The backend fetches this list once a minute and caches it in memory, then filters by your symbol. It's the cleanest public source for 興櫃 prices.

If TPEx ever changes that endpoint, the fix is in `api/price.js` → `fetchEsbList()`.

## Limitations (read these)

- **Prices are delayed**, typically 15-20 min. This is Yahoo's and TPEx's free tier. If you want real-time you'd need a paid feed (Fugle, Polygon, etc.) — ask and I'll wire one in.
- **Screenshot OCR is generic**, not tuned to a specific broker. It extracts text with Tesseract.js and guesses which rows look like holdings (ticker + qty + cost). It works reasonably well but ALWAYS review before saving. If you send me one screenshot from each of your four brokers (with any account numbers / names you want blurred), I can write a per-broker parser that's way more accurate.
- **No sell records / realized P/L**: this only tracks current holdings and unrealized P/L. If you want realized-P/L tracking with transactions (buy/sell history, dividends, fees), that's a bigger feature — easy to add.
- **TW market hours**: `LatestPrice` is from the last trading session. Outside trading hours it'll show yesterday's close — that's expected.
- **興櫃 prices assume non-盤中成交**: the ESB OpenAPI is updated throughout the day but is officially "delayed afterward-trading" data. Most 興櫃 stocks trade thinly anyway so `LatestPrice` is usually what you want.

## Smoke test

```bash
node smoke-test.js
```

Hits the endpoints against real tickers and prints what came back. Run this if you're debugging why a price isn't showing up.

## File layout

```
stock-tracker/
├── index.html              # web app (the UI)
├── manifest.webmanifest    # PWA manifest for "Add to Home Screen"
├── api/
│   ├── price.js            # /api/price?symbol=X&market=tw|twotc|emerging|us
│   └── fx.js               # /api/fx → { rate: TWD per USD }
├── server.js               # local dev server (node server.js)
├── package.json
├── vercel.json             # Vercel routing config
├── smoke-test.js           # sanity check
└── README.md
```

## Next steps / stuff we could add

- Per-broker OCR parsers (send screenshots, I'll build them)
- Transaction history + realized P/L + dividends
- Watchlist (stocks you don't own yet but want to follow)
- Price alerts (push notifications)
- iCloud / Google Drive backup of the exported JSON
- Native iOS (SwiftUI) port — same features, better offline behavior, widget on the home screen
