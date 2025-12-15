// /pages/api/[...path].js
// LevPay Vercel API Gateway -> Proxy ke VPS (HTTP)
// Endpoints:
// - POST /api/createqr
// - GET  /api/status?idTransaksi=...
// - POST /api/status
// - POST /api/cancel
// - GET  /api/qr/<file>.png
// - GET  /api/ (health)

// NOTE: ini cuma proxy. State/polling/watch tetap di VPS.

export const config = {
  api: {
    bodyParser: { sizeLimit: "2mb" },
  },
};

const VPS_BASE = "http://82.27.2.229:5021";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-device-id");
}

function joinUrl(base, path) {
  const b = String(base).replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  return `${b}/${p}`;
}

async function readTextSafe(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function isBinaryPath(pathname) {
  // QR png route
  return pathname.startsWith("api/qr/") || pathname.startsWith("qr/");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // path catch-all
  const parts = Array.isArray(req.query.path) ? req.query.path : (req.query.path ? [req.query.path] : []);
  const first = (parts[0] || "").toLowerCase();

  // Build target path on VPS
  let targetPath = "";

  // Map: /api/<x> -> VPS /api/<x>
  // (kecuali health root)
  if (parts.length === 0) {
    targetPath = ""; // VPS "/"
  } else {
    // keep exact subpath
    targetPath = `api/${parts.map(encodeURIComponent).join("/")}`;

    // special-case: status GET uses query idTransaksi
    // we'll still forward querystring.
  }

  // Preserve querystring
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k === "path") continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
    else if (v !== undefined) qs.set(k, String(v));
  }
  const qsStr = qs.toString();
  const url = joinUrl(VPS_BASE, targetPath) + (qsStr ? `?${qsStr}` : "");

  // Only allow the known endpoints (biar gak jadi open proxy)
  const allowed =
    parts.length === 0 ||
    first === "createqr" ||
    first === "status" ||
    first === "cancel" ||
    first === "qr";

  if (!allowed) {
    return res.status(404).json({ success: false, error: "Unknown endpoint" });
  }

  try {
    // Forward headers (minimal)
    const headers = new Headers();
    headers.set("accept", req.headers.accept || "*/*");
    headers.set("content-type", req.headers["content-type"] || "application/json");

    // optional pass device id
    if (req.headers["x-device-id"]) headers.set("x-device-id", String(req.headers["x-device-id"]));

    // optional pass auth bearer to VPS (kalau VPS pakai callback secret)
    if (req.headers.authorization) headers.set("authorization", String(req.headers.authorization));

    const init = {
      method: req.method,
      headers,
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      // req.body sudah parsed by vercel bodyParser
      init.body = req.body ? JSON.stringify(req.body) : "{}";
    }

    // timeout sederhana
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    init.signal = controller.signal;

    const upstream = await fetch(url, init).finally(() => clearTimeout(t));

    // pass-through status
    res.status(upstream.status);

    // pass-through headers penting
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);

    // binary route (qr png)
    if (isBinaryPath(targetPath) || (ct && ct.includes("image/"))) {
      const ab = await upstream.arrayBuffer();
      const buf = Buffer.from(ab);
      // biar gampang download di browser
      res.setHeader("Cache-Control", "no-store");
      return res.end(buf);
    }

    // json/text
    const text = await readTextSafe(upstream);
    // coba kirim JSON kalau bisa
    try {
      const j = JSON.parse(text || "{}");
      return res.json(j);
    } catch {
      return res.send(text);
    }
  } catch (err) {
    const msg =
      err?.name === "AbortError"
        ? "Upstream timeout"
        : (err?.message || "Proxy error");

    return res.status(502).json({
      success: false,
      error: msg,
      upstream: VPS_BASE,
    });
  }
}
