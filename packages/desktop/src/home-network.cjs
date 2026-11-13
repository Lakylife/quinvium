// Adresa počítače v domácí síti se může změnit, třeba při přechodu z kabelu na Wi-Fi. Spojení mezi uzly to přežije,
// protože se najdou samy, ale uložená adresa poolu nebo aktualizací by dál mířila do prázdna a těžba by tiše stála.
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * Když služba na uložené adrese neodpovídá, zkusí stejný port u spojených uzlů v soukromé síti.
 * Cizí stroj tím nic nezíská: aktualizace musí mít podpis a podíly do poolu ověřuje kontrakt.
 * @param {string} url uložená adresa
 * @param {{ address: string }[]} peers spojené uzly
 * @param {(url: string) => Promise<boolean>} alive běží tam ta služba?
 * @returns {Promise<string>} funkční adresa, nebo původní, když žádná neodpověděla
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
