// api/status.js
const dayjs = require("dayjs");
const { get, set } = require("./_store");
const { ORKUT_AUTH_USERNAME, ORKUT_AUTH_TOKEN } = require("./_config");
const { PaymentChecker } = require("autoft-qris");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // VPS -> POST update status (sinyal)
  if (req.method === "POST") {
    const body = req.body || {};
    const reference = body.reference || body.idTransaksi;
    const status = (body.status || "").toString().toUpperCase();

    if (!reference) {
      return res.status(400).json({ success: false, error: "reference required" });
    }

    const prev = get(reference) || {};
    const merged = {
      ...prev,
      ...body,
      reference,
      status: status || prev.status || "PENDING",
      lastSignalAt: new Date().toISOString(),
      source: "vps-signal"
    };

    // TTL 30 menit biar aman
    set(reference, merged, 30 * 60 * 1000);

    return res.status(200).json({ success: true, data: merged });
  }

  // Frontend / VPS polling -> GET check realtime
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const reference = (req.query && req.query.reference) || (req.query && req.query.idTransaksi);
  const amount = req.query && req.query.amount;

  if (!reference) {
    return res.status(400).json({ success: false, error: "reference is required" });
  }

  const cached = get(reference);

  // kalau udah CANCELLED / PAID dari cache, langsung return (hemat request)
  if (cached && (cached.status === "PAID" || cached.status === "CANCELLED")) {
    return res.status(200).json({ success: true, data: { ...cached, watching: false } });
  }

  // kalau expired dari cache dan sudah lewat expiredAt, stop
  if (cached && cached.expiredAt && dayjs().isAfter(dayjs(cached.expiredAt))) {
    const data = { ...cached, status: "EXPIRED", watching: false, source: "local-expired" };
    set(reference, data, 10 * 60 * 1000);
    return res.status(200).json({ success: true, data });
  }

  // untuk check realtime butuh amount
  const numericAmount = Number(amount || cached?.amount);
  if (!numericAmount || Number.isNaN(numericAmount)) {
    return res.status(400).json({
      success: false,
      error: "amount required (query ?amount=) atau harus sudah tersimpan dari createqr"
    });
  }

  try {
    const checker = new PaymentChecker({
      auth_username: ORKUT_AUTH_USERNAME,
      auth_token: ORKUT_AUTH_TOKEN
    });

    const result = await checker.checkPaymentStatus(reference, numericAmount);

    // normalisasi status
    const status = (result?.data?.status || result?.data?.Status || "PENDING")
      .toString()
      .toUpperCase();

    const data = {
      ...(cached || {}),
      reference,
      amount: numericAmount,
      status,
      lastCheckAt: new Date().toISOString(),
      source: "orderkuota-check",
      raw: result
    };

    // kalau paid, simpen lama dikit
    if (status === "PAID") {
      set(reference, data, 60 * 60 * 1000);
      return res.status(200).json({ success: true, data: { ...data, watching: false } });
    }

    // kalau expired, stop polling
    if (status === "EXPIRED") {
      set(reference, data, 30 * 60 * 1000);
      return res.status(200).json({ success: true, data: { ...data, watching: false } });
    }

    // pending dll
    set(reference, data, 30 * 60 * 1000);
    return res.status(200).json({ success: true, data: { ...data, watching: true } });
  } catch (e) {
    // supaya gak 500 spam, balikkan error tapi tetap JSON
    return res.status(200).json({
      success: false,
      error: e.message,
      data: cached || null
    });
  }
};
