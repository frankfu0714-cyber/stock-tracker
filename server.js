// Tiny local dev server. Serves index.html and static files, and mounts
// /api/price + /api/fx using the same handlers Vercel would run.
//
//   node server.js            # listens on http://localhost:3000
//   PORT=4000 node server.js  # custom port
//
// Works on any machine with Node 18+ (has built-in fetch).

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const priceHandler = require("./api/price.js");
const fxHandler = require("./api/fx.js");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function wrap(handler) {
  return async (req, res) => {
    const parsed = url.parse(req.url, true);
    req.query = parsed.query || {};
    // Adapt Node http res -> Vercel-style res
    const origStatus = res.statusCode;
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      if (!res.getHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(obj));
      return res;
    };
    try { await handler(req, res); }
    catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
  };
}

const price = wrap(priceHandler);
const fx = wrap(fxHandler);

http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "/";
  // API routes
  if (pathname === "/api/price") return price(req, res);
  if (pathname === "/api/fx")    return fx(req, res);

  // Static files
  let rel = pathname === "/" ? "/index.html" : pathname;
  // Prevent directory traversal
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.statusCode = 403; return res.end("forbidden"); }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.statusCode = 404; return res.end("not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader("content-type", MIME[ext] || "application/octet-stream");
    res.setHeader("Access-Control-Allow-Origin", "*");
    fs.createReadStream(filePath).pipe(res);
  });
}).listen(PORT, () => {
  console.log(`Stock Tracker running at http://localhost:${PORT}`);
  console.log(`In the app's Settings, set Price API base URL to: http://localhost:${PORT}`);
});
