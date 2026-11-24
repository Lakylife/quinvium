// A pool's server address is set by the pool operator on chain and becomes an argument of the miner process.
// Only a plain address is accepted: http or https, a host of letters, digits, dots and dashes (or a bracketed IPv6
// address), an optional port and an optional path of letters, digits and / . - _ ~; no query, fragment, spaces or
// credentials, at most 128 characters. The same rule is in the Explorer (safePoolUrl in app.js) and the app window.

const POOL_URL = /^https?:\/\/(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]*:[0-9a-f:.]*\])(?::(\d{1,5}))?(?:\/[a-z0-9/._~-]*)?$/i;

/** @returns {string | null} the address when it is a plain pool address, otherwise null */
function safePoolUrl(url) {
  if (typeof url !== 'string' || url.length > 128) return null;
  const m = POOL_URL.exec(url);
  if (!m || (m[1] !== undefined && Number(m[1]) > 65535)) return null;
  return url;
}

module.exports = { POOL_URL, safePoolUrl };
