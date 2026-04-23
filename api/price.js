// Vercel serverless function: GET /api/price?symbol=2330&market=tw|twotc|emerging|us
// Returns: { price: number, currency: "TWD"|"USD", name?: string, source: string, ts: number }
//
// Sources:
//   tw, twotc, us  -> Yahoo Finance (query1.finance.yahoo.com/v8/finance/chart)
//   emerging       -> TPEx official OpenAPI (tpex_esb_latest_statistics) — full list of 興櫃
//                     quotes, cached in memory for 60s.

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

// In-memory cache for the 興櫃 list. Warm-function lifetime only, but that's fine —
// we fetch ~140KB once per minute regardless of how many symbols we look up.
let _esbCache = { data: null, ts: 0 };
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
    if (market === "emerging") data = await tpexEmerging(symbol);
    else if (["tw", "twotc", "us"].includes(market)) data = await yahoo(symbol, market);
    else return res.status(400).json({ error: "unknown market: " + market });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message || String(e) });
  }
};
