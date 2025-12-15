// api/[...path].js
// LevPay Vercel API Gateway -> Proxy ke VPS (HTTP)
// Endpoint contoh:
// - POST /api/createqr
// - GET  /api/status?idTransaksi=...
// - POST /api/status
// - GET  /api/qr/<file>.png
// - GET  /api  (health)

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function joinUrl(base, p) {
  const b = String(base || "").replace(/\/+$/, "");
  const path = String(p || "").replace(/^\/+/, "");
  return `${b}/${path}`;
}

function readRawBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // VPS base (default sesuai host 82 lu)
  const VPS_BASE = process.env.VPS_BASE || "http://82.27.2.229:5021";

  // Ambil path dynamic: [...path]
  // Biasanya jadi req.query.path (string/array)
  const raw = req.query?.path;
  const parts = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const subPath = parts.join("/"); // contoh: "createqr", "status", "qr/xxxx.png"

  // Query string (kecuali "path" param bawaan)
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k === "path") continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v !== undefined) qs.append(k, v);
  }

  const url = joinUrl(VPS_BASE, "api/" + subPath) + (qs.toString() ? `?${qs}` : "");

  // Ambil body mentah (biar aman buat JSON)
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const rawBody = hasBody ? await readRawBody(req) : null;

  // Forward request ke VPS
  let upstream;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers: {
        "Content-Type": req.headers["content-type"] || "application/json"
      },
      body: rawBody
    });
  } catch (e) {
    res.statusCode = 502;
    return res.json({ success: false, error: "Proxy error: " + e.message });
  }

  // Forward response (PNG / JSON / text)
  const ct = upstream.headers.get("content-type") || "";

  res.statusCode = upstream.status;
  setCors(res);
  if (ct) res.setHeader("Content-Type", ct);

  if (ct.includes("image/png")) {
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.end(buf);
  }

  const text = await upstream.text();
  // coba parse json kalau bisa
  try {
    return res.end(JSON.stringify(JSON.parse(text)));
  } catch {
    return res.end(text);
  }
};
