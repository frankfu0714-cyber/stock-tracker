// Vercel serverless function: GET /api/price?symbol=2330&market=tw|twotc|emerging|us
// Returns: { price: number, currency: "TWD"|"USD", name?: string, source: string, ts: number }
//
// Sources:
//   tw, twotc  -> Yahoo Finance for price; TWSE/TPEx OpenAPI for Chinese name (5-min cache)
//   emerging   -> TPEx official OpenAPI (tpex_esb_latest_statistics) — full 興櫃 list, 60s cache
//   us         -> Yahoo Finance

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

async function yahoo(symbol, market) {
  // Yahoo tickers:
  //   TWSE (上市)  -> 2330.TW
  //   TPEx (上櫃)  -> 6488.TWO
  //   US          -> AAPL
  const ySym =
    market === "tw"    ? `${symbol}.TW`
  : market === "twotc" ? `${symbol}.TWO`
  : symbol;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d&range=5d`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 StockTracker" } });
  if (!r.ok) throw new Error("yahoo http " + r.status);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error("yahoo no data");
  const meta = result.meta || {};
  const price = meta.regularMarketPrice ?? result.indicators?.quote?.[0]?.close?.slice(-1)?.[0];
  if (typeof price !== "number") throw new Error("yahoo no price");
  return {
    price,
    currency: meta.currency || (market === "us" ? "USD" : "TWD"),
    name: meta.shortName || meta.longName || "",
    source: "yahoo",
    ts: Date.now(),
  };
}

// In-memory caches — warm-function lifetime only, refreshed on TTL expiry.
let _esbCache  = { data: null, ts: 0 };   // 興櫃 full list,  60s TTL
let _twseCache = { data: null, ts: 0 };   // TWSE name map,  5-min TTL
let _otcCache  = { data: null, ts: 0 };   // TPEx OTC name map, 5-min TTL

async function fetchTwseNames() {
  const now = Date.now();
  if (_twseCache.data && (now - _twseCache.ts) < 300_000) return _twseCache.data;
  const r = await fetch("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", {
    headers: { "User-Agent": "Mozilla/5.0 StockTracker" },
  });
  if (!r.ok) throw new Error("twse http " + r.status);
  const arr = await r.json();
  if (!Array.isArray(arr)) throw new Error("twse bad response");
  const map = {};
  for (const item of arr) if (item.Code && item.Name) map[item.Code.trim()] = item.Name.trim();
  _twseCache = { data: map, ts: now };
  return map;
}

async function fetchOtcNames() {
  const now = Date.now();
  if (_otcCache.data && (now - _otcCache.ts) < 300_000) return _otcCache.data;
  const r = await fetch("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes", {
    headers: { "User-Agent": "Mozilla/5.0 StockTracker", "Accept": "application/json",
               "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8" },
  });
  if (!r.ok) throw new Error("otc http " + r.status);
  const arr = await r.json();
  if (!Array.isArray(arr)) throw new Error("otc bad response");
  const map = {};
  for (const item of arr) {
    const code = String(item.SecuritiesCompanyCode || "").trim();
    const name = String(item.CompanyName || "").trim();
    if (code && name) map[code] = name;
  }
  _otcCache = { data: map, ts: now };
  return map;
}

async function fetchEsbList() {
  const now = Date.now();
  if (_esbCache.data && (now - _esbCache.ts) < 60 * 1000) return _esbCache.data;
  const url = "https://www.tpex.org.tw/openapi/v1/tpex_esb_latest_statistics";
  const r = await fetch(url, { headers: {
    "User-Agent": "Mozilla/5.0 StockTracker",
    "Accept": "application/json",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
  }});
  if (!r.ok) throw new Error("tpex http " + r.status);
  const arr = await r.json();
  if (!Array.isArray(arr)) throw new Error("tpex bad response");
  _esbCache = { data: arr, ts: now };
  return arr;
}

async function tpexEmerging(symbol) {
  const arr = await fetchEsbList();
  const row = arr.find(r => String(r.SecuritiesCompanyCode).trim() === String(symbol).trim());
  if (!row) throw new Error("symbol not found in 興櫃 list: " + symbol);
  // LatestPrice is the last traded price. If no trade today, fall back to Average / PreviousAverage.
  const pick = (v) => {
    const n = parseFloat(String(v).replace(/,/g, ""));
    return isFinite(n) && n > 0 ? n : null;
  };
  const price =
    pick(row.LatestPrice) ||
    pick(row.Average) ||
    pick(row.PreviousAveragePrice) ||
    pick(row.BuyingPrice) ||
    pick(row.SellingPrice);
  if (price == null) throw new Error("no usable price for " + symbol);
  return {
    price,
    currency: "TWD",
    name: row.CompanyName || "",
    source: "tpex-openapi",
    extra: {
      buy: pick(row.BuyingPrice),
      sell: pick(row.SellingPrice),
      high: pick(row.Highest),
      low: pick(row.Lowest),
      volume: pick(row.TransactionVolume),
      previousAvg: pick(row.PreviousAveragePrice),
      date: row.Date,
      time: row.Time,
    },
    ts: Date.now(),
  };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const symbol = (req.query?.symbol || "").toString().trim().toUpperCase();
  const market = (req.query?.market || "tw").toString().trim().toLowerCase();
  if (!symbol) return res.status(400).json({ error: "missing symbol" });

  try {
    let data;
    if (market === "emerging") {
      data = await tpexEmerging(symbol);
    } else if (["tw", "twotc"].includes(market)) {
      try {
        data = await yahoo(symbol, market);
      } catch (yahooErr) {
        // 興櫃 stocks are sometimes misclassified as 上市/上櫃 by OCR.
        // If Yahoo 404s, fall back to the TPEx emerging market feed.
        if (/404|no data/i.test(yahooErr.message)) {
          data = await tpexEmerging(symbol);
        } else {
          throw yahooErr;
        }
      }
      // Replace Yahoo's English name with the Chinese name from TWSE/TPEx.
      // Non-fatal: if the name API fails, we keep Yahoo's English name.
      if (data.source === "yahoo") {
        try {
          const names = market === "tw" ? await fetchTwseNames() : await fetchOtcNames();
          if (names[symbol]) data = { ...data, name: names[symbol] };
        } catch {}
      }
    } else if (market === "us") {
      data = await yahoo(symbol, market);
    } else {
      return res.status(400).json({ error: "unknown market: " + market });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message || String(e) });
  }
};
