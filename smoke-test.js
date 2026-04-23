// Smoke test: hit price + fx handlers with a few real tickers and print results.
//   node smoke-test.js
const priceHandler = require("./api/price.js");
const fxHandler = require("./api/fx.js");

function mockReqRes(query) {
  let statusCode = 200, body = null;
  const res = {
    setHeader() {},
    status(c) { statusCode = c; return res; },
    json(o) { body = o; return res; },
    end(s) { if (body == null) body = s; return res; },
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
  };
  return [{ query, method: "GET" }, res, () => ({ status: statusCode, body })];
}

async function hit(handler, query, label) {
  const [req, res, done] = mockReqRes(query);
  try { await handler(req, res); }
  catch (e) { console.log(`FAIL ${label}  -> threw: ${e.message}`); return; }
  const { status, body } = done();
  const ok = status === 200 && body && (body.price || body.rate);
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  status=${status}  ${JSON.stringify(body).slice(0, 200)}`);
}

(async () => {
  await hit(fxHandler, {}, "FX USDTWD");
  await hit(priceHandler, { symbol: "2330", market: "tw" }, "TSE 2330 台積電 (上市)");
  await hit(priceHandler, { symbol: "6488", market: "twotc" }, "OTC 6488 環球晶 (上櫃)");
  await hit(priceHandler, { symbol: "AAPL", market: "us" }, "US AAPL");
  await hit(priceHandler, { symbol: "GOOGL", market: "us" }, "US GOOGL");
  // 興櫃 — real codes from TPEx ESB OpenAPI (list changes — verify with /api/price if unsure)
  await hit(priceHandler, { symbol: "1260", market: "emerging" }, "興櫃 1260 富味鄉");
  await hit(priceHandler, { symbol: "1269", market: "emerging" }, "興櫃 1269 乾杯");
  await hit(priceHandler, { symbol: "9999", market: "emerging" }, "興櫃 9999 (should fail gracefully)");
})();
