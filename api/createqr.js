// api/createqr.js
const QRCode = require("qrcode");
const dayjs = require("dayjs");
const axios = require("axios");
const { nanoid } = require("nanoid");
const { set } = require("./_store");
const {
  ORKUT_AUTH_USERNAME,
  ORKUT_AUTH_TOKEN,
  BASE_QR_STRING,
  VPS_WATCH_URL
} = require("./_config");

// PAKAI autoft-qris cuma untuk checker logic nanti (di /api/status)
// generate QR kita pakai qrcode biar gak ribet canvas/native deps.
const { QRISGenerator } = require("autoft-qris");

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

  const { amount } = req.body || {};
  const numericAmount = Number(amount);

  if (!amount || Number.isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ success: false, error: "Invalid amount" });
  }

  // reference/id transaksi versi kita (yang dipakai buat check)
  const reference = `REF${Date.now()}_${nanoid(6)}`;

  const createdAt = new Date().toISOString();
  // readme bilang window 5 menit
  const expiredAt = dayjs().add(5, "minute").toISOString();

  // bikin QR string dari base string + amount
  // autoft-qris QRISGenerator.generateQrString() handle CRC dll.
  const qrisGen = new QRISGenerator(
    {
      baseQrString: BASE_QR_STRING,
      // auth_... gak dipake di generator, tapi gapapa
      auth_username: ORKUT_AUTH_USERNAME,
      auth_token: ORKUT_AUTH_TOKEN,
      storeName: "LEV PAY"
    },
    "theme1"
  );

  const qrString = qrisGen.generateQrString(numericAmount);

  // QR image -> dataURL (base64 png)
  const qrDataUrl = await QRCode.toDataURL(qrString, {
    margin: 1,
    width: 512
  });

  // simpen status awal (biar /api/status bisa kasih state walau belum cek)
  set(reference, {
    reference,
    amount: numericAmount,
    createdAt,
    expiredAt,
    status: "PENDING",
    source: "local-init"
  }, 10 * 60 * 1000);

  // OPTIONAL: kalau lu masih mau VPS yang polling,
  // kirim info transaksi ke VPS supaya VPS mulai watcher.
  // (Kalau VPS lu gak butuh, boleh hapus block ini.)
  let watcherStarted = false;
  if (VPS_WATCH_URL && VPS_WATCH_URL.startsWith("http")) {
    try {
      await axios.post(
        VPS_WATCH_URL,
        { reference, amount: numericAmount, createdAt, expiredAt },
        { timeout: 5000, validateStatus: () => true }
      );
      watcherStarted = true;
    } catch (_) {
      watcherStarted = false;
    }
  }

  return res.status(200).json({
    success: true,
    watcherStarted,
    data: {
      reference,
      amount: numericAmount,
      createdAt,
      expiredAt,
      qrString,
      qrDataUrl
    }
  });
};
