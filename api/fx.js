// Vercel serverless function: GET /api/fx
// Returns: { rate: number, pair: "USDTWD", source: "yahoo", ts: number }
// rate = TWD per 1 USD.

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    // Yahoo Finance quote for TWD=X (USD -> TWD)
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/TWD=X?interval=1d&range=5d";
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 StockTracker" } });
    if (!r.ok) throw new Error("yahoo http " + r.status);
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    const rate = meta?.regularMarketPrice;
    if (typeof rate !== "number") throw new Error("no rate");
    return res.status(200).json({ rate, pair: "USDTWD", source: "yahoo", ts: Date.now() });
  } catch (e) {
    return res.status(502).json({ error: e.message || String(e) });
  }
};
