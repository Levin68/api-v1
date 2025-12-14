// api/_store.js
const store = new Map();

// default TTL 10 menit
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  const expiresAt = Date.now() + ttlMs;
  store.set(key, { value, expiresAt });
}

function get(key) {
  const item = store.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    store.delete(key);
    return null;
  }
  return item.value;
}

function del(key) {
  store.delete(key);
}

module.exports = { set, get, del };
