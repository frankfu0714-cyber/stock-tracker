// Vercel serverless function: POST /api/ocr
// Body: { images: [{ data: base64string, mimeType: string }] }
// Returns: JSON array of holdings
// Requires GEMINI_API_KEY environment variable.

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const PROMPT = `You are a financial data extractor. Analyze these broker account screenshots and extract all stock holdings.

For each holding found, return a JSON object with these fields:
- symbol: the stock code (4-digit number for Taiwan stocks like "2330", uppercase letters for US stocks like "AAPL")
- name: company name (string, optional)
- qty: number of shares held (positive number)
- cost: average cost per share (positive number)
- market: one of:
  "tw" = Taiwan TWSE 上市 listed stocks (4-digit codes)
  "twotc" = Taiwan TPEx 上櫃 OTC stocks (4-digit codes)
  "emerging" = Taiwan 興櫃 emerging market stocks
  "us" = US stocks (letter-based tickers like AAPL, TSLA)

Return ONLY a valid JSON array. No markdown, no code fences, no explanation — just the array.
Example: [{"symbol":"2330","name":"台積電","qty":1000,"cost":900.5,"market":"tw"},{"symbol":"AAPL","qty":10,"cost":150.25,"market":"us"}]

Rules:
- Include only actual stock holdings (rows that have a symbol + quantity + cost basis)
- Skip totals, subtotals, cash balances, bonds, fund NAV rows, column headers, empty rows
- If market type is ambiguous, default "tw" for 4-digit numeric codes
- qty and cost must be positive numbers
- For TW stocks cost is TWD per share; for US stocks cost is USD per share
- If a field is unavailable, omit it`;

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });

  const { images } = req.body || {};
  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: "images array required" });
  }

  // Build parts: system prompt + all images
  const parts = [{ text: PROMPT }];
  for (const img of images) {
    if (!img.data || !img.mimeType) continue;
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }

  try {
    const r = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Gemini ${r.status}: ${errText.slice(0, 300)}`);
    }

    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("empty response from Gemini");

    let holdings;
    try {
      holdings = JSON.parse(text);
    } catch {
      throw new Error("Gemini returned non-JSON: " + text.slice(0, 200));
    }
    if (!Array.isArray(holdings)) throw new Error("Gemini response is not an array");

    // Validate and sanitize
    holdings = holdings
      .filter(h => h.symbol && isFinite(h.qty) && isFinite(h.cost) && h.qty > 0 && h.cost > 0)
      .map(h => ({
        symbol: String(h.symbol).trim().toUpperCase(),
        name: h.name ? String(h.name).slice(0, 40) : "",
        qty: Number(h.qty),
        cost: Number(h.cost),
        market: ["tw", "twotc", "emerging", "us"].includes(h.market) ? h.market : "tw",
      }));

    return res.status(200).json(holdings);
  } catch (e) {
    return res.status(502).json({ error: e.message || String(e) });
  }
};
