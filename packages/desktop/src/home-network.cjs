// A computer's address on the home network can change, for example when switching from cable to Wi-Fi. Connections between nodes survive it,
// because they find each other, but a stored pool or update address would keep pointing into the void and mining would silently stop.
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * If the service at the stored address does not answer, it tries the same port on connected nodes in the private network.
 * A foreign machine gains nothing from it: updates must be signed and the contract verifies shares submitted to the pool.
 * @param {string} url stored address
 * @param {{ address: string }[]} peers connected nodes
 * @param {(url: string) => Promise<boolean>} alive is the service running there?
 * @returns {Promise<string>} a working address, or the original one when none answered
 */
async function followHost(url, peers, alive) {
  const original = new URL(url);
  if (!PRIVATE.test(original.hostname) || await alive(url)) return url;
  const hosts = new Set(peers.map((p) => p.address.replace(/:\d+$/, '')).filter((h) => PRIVATE.test(h) && h !== original.hostname));
  for (const host of hosts) {
    const candidate = url.replace(original.hostname, host);
    if (await alive(candidate)) return candidate;
  }
  return url;
}

module.exports = { followHost };
