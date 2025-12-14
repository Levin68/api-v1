// api/cancel.js
const axios = require("axios");
const { get, set } = require("./_store");
const { VPS_CANCEL_URL } = require("./_config");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const { reference } = req.body || {};
  if (!reference) {
    return res.status(400).json({ success: false, error: "reference required" });
  }

  const prev = get(reference) || {};
  const data = {
    ...prev,
    reference,
    status: "CANCELLED",
    cancelledAt: new Date().toISOString(),
    source: "local-cancel"
  };

  set(reference, data, 60 * 60 * 1000);

  // OPTIONAL: kalau VPS lu punya endpoint cancel, kirim juga
  let vpsCancel = false;
  if (VPS_CANCEL_URL && VPS_CANCEL_URL.startsWith("http")) {
    try {
      await axios.post(`${VPS_CANCEL_URL}/${encodeURIComponent(reference)}`, {}, { timeout: 5000 });
      vpsCancel = true;
    } catch (_) {
      vpsCancel = false;
    }
  }

  return res.status(200).json({ success: true, vpsCancel, data });
};
