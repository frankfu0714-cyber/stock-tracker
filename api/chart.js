// Vercel serverless: GET /api/chart?symbol=2330&market=tw
// Returns: { points:[{t,p}], open, currency }
// t = Unix seconds, p = close price, open = chartPreviousClose (reference for green/red)

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const symbol = (req.query?.symbol || "").toString().trim().toUpperCase();
  const market = (req.query?.market || "tw").toString().trim().toLowerCase();
  if (!symbol) return res.status(400).json({ error: "missing symbol" });

  // 興櫃 stocks have no Yahoo intraday data
  if (market === "emerging") {
    return res.status(200).json({ points: [], open: null, currency: "TWD" });
  }

  const ySym =
    market === "tw"    ? `${symbol}.TW`
  : market === "twotc" ? `${symbol}.TWO`
  : symbol;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?range=1d&interval=5m`;

  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 StockTracker" } });
    if (!r.ok) throw new Error("yahoo http " + r.status);
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result) throw new Error("no data");

    const meta = result.meta || {};
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    // chartPreviousClose is yesterday's close — used to color the line green/red
    const open = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const currency = meta.currency || (market === "us" ? "USD" : "TWD");

    const points = [];
    for (let i = 0; i < timestamps.length; i++) {
      const p = closes[i];
      if (typeof p === "number" && isFinite(p)) {
        points.push({ t: timestamps[i], p });
      }
    }

    return res.status(200).json({ points, open, currency });
  } catch (e) {
    return res.status(502).json({ error: e.message || String(e) });
  }
};
