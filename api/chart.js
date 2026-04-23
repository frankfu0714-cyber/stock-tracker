// Vercel serverless: GET /api/chart?symbol=2330&market=tw&range=1d
// Returns: { points:[{t,p}], open, currency }
// t = Unix seconds, p = close price, open = chartPreviousClose (reference for green/red)

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

// interval is fixed per range to avoid Yahoo rejection
const RANGE_INTERVAL = { "1d": "5m", "5d": "15m", "1mo": "1h", "1y": "1d" };

async function yahooChart(ySym, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?range=${range}&interval=${interval}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 StockTracker" } });
  if (!r.ok) throw new Error("yahoo http " + r.status);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error("no data");
  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const open = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const currency = meta.currency || "TWD";
  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    const p = closes[i];
    if (typeof p === "number" && isFinite(p)) points.push({ t: timestamps[i], p });
  }
  return { points, open, currency };
}

// Fetch one month of TPEx daily data; rocDateStr = "YYY/MM/DD" (ROC calendar)
async function tpexMonth(symbol, rocDateStr) {
  const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&d=${encodeURIComponent(rocDateStr)}&stkno=${encodeURIComponent(symbol)}&ajax=1`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 StockTracker",
      "Accept": "application/json",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      "Referer": "https://www.tpex.org.tw/",
    },
  });
  if (!r.ok) throw new Error("tpex http " + r.status);
  const j = await r.json();
  const rows = j?.aaData;
  if (!Array.isArray(rows)) throw new Error("tpex bad response");
  return rows;
}

// Convert ROC date "YYY/MM/DD" to Unix seconds (Taiwan noon = UTC 04:00)
function rocToUnix(rocDateStr) {
  const parts = rocDateStr.trim().split("/");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0]) + 1911;
  const month = parseInt(parts[1]) - 1;
  const day = parseInt(parts[2]);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return Math.floor(new Date(Date.UTC(year, month, day, 4, 0, 0)) / 1000);
}

async function emergingHistorical(symbol, range) {
  // No intraday data exists for 興櫃 stocks
  if (range === "1d") return { points: [], open: null, currency: "TWD" };

  // Try Yahoo with .TWO suffix — some 興櫃 stocks have data there
  try {
    const data = await yahooChart(`${symbol}.TWO`, range, "1d");
    if (data.points.length >= 2) return { ...data, currency: "TWD" };
  } catch (_) {}

  // 1y: skip TPEx (would require 12 monthly fetches)
  if (range === "1y") return { points: [], open: null, currency: "TWD" };

  // Fallback: TPEx monthly endpoint for 5d / 1mo
  try {
    const now = new Date();

    // Fetch current month and previous month (handles month-boundary edge cases)
    const dates = [
      new Date(now.getFullYear(), now.getMonth() - 1, 15),
      now,
    ];
    let allRows = [];
    for (const d of dates) {
      const rocYear = d.getFullYear() - 1911;
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      try {
        const rows = await tpexMonth(symbol, `${rocYear}/${mm}/${dd}`);
        allRows = allRows.concat(rows);
      } catch (_) {}
    }

    // Parse rows: [date, vol, amount, open, high, low, close, change, trades]
    const seen = new Set();
    const allPoints = [];
    for (const row of allRows) {
      if (!Array.isArray(row) || row.length < 7) continue;
      const dateStr = String(row[0]).trim();
      if (seen.has(dateStr)) continue;
      seen.add(dateStr);
      const p = parseFloat(String(row[6]).replace(/,/g, ""));
      const t = rocToUnix(dateStr);
      if (t && isFinite(p) && p > 0) allPoints.push({ t, p });
    }
    allPoints.sort((a, b) => a.t - b.t);

    if (allPoints.length === 0) return { points: [], open: null, currency: "TWD" };

    let points;
    if (range === "5d") {
      points = allPoints.slice(-5);
    } else {
      // 1mo: last 31 calendar days
      const cutoff = Math.floor(Date.now() / 1000) - 31 * 86400;
      points = allPoints.filter(pt => pt.t >= cutoff);
      if (points.length === 0) points = allPoints.slice(-22);
    }

    // open = last close before the period window
    let open = null;
    for (let i = allPoints.length - 1; i >= 0; i--) {
      if (allPoints[i].t < points[0].t) { open = allPoints[i].p; break; }
    }

    return { points, open, currency: "TWD" };
  } catch (_) {
    return { points: [], open: null, currency: "TWD" };
  }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const symbol = (req.query?.symbol || "").toString().trim().toUpperCase();
  const market = (req.query?.market || "tw").toString().trim().toLowerCase();
  const range   = RANGE_INTERVAL[req.query?.range] ? req.query.range : "1d";
  const interval = RANGE_INTERVAL[range];

  if (!symbol) return res.status(400).json({ error: "missing symbol" });

  if (market === "emerging") {
    try {
      return res.status(200).json(await emergingHistorical(symbol, range));
    } catch (_) {
      return res.status(200).json({ points: [], open: null, currency: "TWD" });
    }
  }

  const ySym =
    market === "tw"    ? `${symbol}.TW`
  : market === "twotc" ? `${symbol}.TWO`
  : symbol;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?range=${range}&interval=${interval}`;

  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 StockTracker" } });
    if (!r.ok) throw new Error("yahoo http " + r.status);
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result) throw new Error("no data");

    const meta = result.meta || {};
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

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
