// Aktualizace na dálku a hlášení stavu pro testovací provoz. Obojí je vypnuté, dokud nastavení neurčí adresu.
// Aktualizace je spuštění cizího kódu na počítači uživatele, proto se přijme jen balíček podepsaný klíčem vydavatele
// a jen novější verze. Adresa serveru tak nemusí být důvěryhodná a soukromý klíč nikdy neopouští počítač vydavatele.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isNewer } = require('./versions.cjs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEApnfEpCT34oj8xVXT3h/ch0LFaOv3Js/FweG9WNuOXl8=
-----END PUBLIC KEY-----
`;
const MAX_MANIFEST = 16 * 1024;
const MAX_PACKAGE = 1024 * 1024 * 1024;
const REQUEST_MS = 15_000;
const PLATFORMS = ['win32', 'darwin'];

/**
 * Ověří podpis a tvar popisu aktualizace. Soubor se jmenuje jen prostým názvem, ne cestou nebo adresou.
 * Platforma je součástí podpisu: jinak by server mohl Macu podstrčit platný balíček pro Windows.
 * @param {string} [platform] očekávaná platforma, `win32` nebo `darwin`
 */
function verifyManifest(text, signature, key = PUBLIC_KEY, platform) {
  if (!crypto.verify(null, Buffer.from(text), key, Buffer.from(signature.trim(), 'base64'))) throw new Error('Podpis aktualizace nesouhlasí');
  const m = JSON.parse(text);
  if (!/^\d+\.\d+\.\d+$/.test(m.version ?? '')) throw new Error('Neplatná verze aktualizace');
  if (!/^[A-Za-z0-9._-]+\.zip$/.test(m.file ?? '')) throw new Error('Neplatný název balíčku');
  if (!/^[0-9a-f]{64}$/.test(m.sha256 ?? '')) throw new Error('Neplatný otisk balíčku');
  if (!Number.isInteger(m.size) || m.size <= 0 || m.size > MAX_PACKAGE) throw new Error('Neplatná velikost balíčku');
  if (!PLATFORMS.includes(m.platform)) throw new Error('Aktualizace neuvádí platformu');
  if (platform && m.platform !== platform) throw new Error(`Aktualizace je pro jinou platformu (${m.platform})`);
  return m;
}

async function fetchText(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(REQUEST_MS) });
  if (!r.ok) throw new Error(`Server vrátil ${r.status}`);
  const text = await r.text();
  if (text.length > MAX_MANIFEST) throw new Error('Popis aktualizace je příliš dlouhý');
  return text;
}

/** @returns {Promise<object|null>} ověřený popis novější verze, jinak null */
async function checkForUpdate(baseUrl, currentVersion, name = 'manifest', platform = process.platform) {
  const base = baseUrl.replace(/\/$/, '');
  const [text, signature] = await Promise.all([fetchText(`${base}/${name}.json`), fetchText(`${base}/${name}.sig`)]);
  const manifest = verifyManifest(text, signature, PUBLIC_KEY, platform);
  return isNewer(manifest.version, currentVersion) ? manifest : null;
}

/**
 * Stáhne balíček a ověří velikost i otisk. Neúplný nebo změněný soubor se smaže.
 * Stahování skončí hned, jak server pošle víc, než slibuje podepsaný popis, jinak by mohl zaplnit disk.
 */
async function downloadPackage(baseUrl, manifest, directory) {
  const target = path.join(directory, manifest.file);
  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/${manifest.file}`, { signal: AbortSignal.timeout(600_000) });
  if (!r.ok || !r.body) throw new Error(`Server vrátil ${r.status}`);
  let received = 0;
  const limit = new Transform({
    transform(chunk, _, done) {
      received += chunk.length;
      done(received > manifest.size ? new Error('Stažený balíček nesouhlasí s podpisem: je větší') : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(r.body), limit, fs.createWriteStream(target));
  } catch (e) {
    fs.rmSync(target, { force: true });
    throw e;
  }
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(target), hash);
  if (hash.digest('hex') !== manifest.sha256 || fs.statSync(target).size !== manifest.size) {
    fs.rmSync(target, { force: true });
    throw new Error('Stažený balíček nesouhlasí s podpisem');
  }
  return target;
}

/** Počítadla z řádku těžaře `Výkon 3.91 MH/s, nalezené bloky 2, osiřelé 1, odmítnuté 0`. */
function parseMinerLine(line) {
  const m = /Výkon ([\d.]+) ([^\s,]+), nalezené bloky (\d+), osiřelé (\d+), odmítnuté (\d+)(?:, podíly (\d+))?/.exec(line);
  if (!m) return null;
  const scale = { 'H/s': 1, 'kH/s': 1e3, 'MH/s': 1e6, 'GH/s': 1e9 }[m[2]] ?? 1;
  return { rate: Math.round(Number(m[1]) * scale), found: Number(m[3]), stale: Number(m[4]), rejected: Number(m[5]), shares: Number(m[6] ?? 0) };
}

/** Odešle řádek stavu na adresu z nastavení. Výpadek serveru nesmí aplikaci nijak ovlivnit. */
async function sendReport(reportUrl, name, data) {
  const url = `${reportUrl.replace(/\/$/, '')}/report?name=${encodeURIComponent(name)}`;
  await fetch(url, { method: 'POST', body: `${JSON.stringify(data)}\n`, signal: AbortSignal.timeout(5000) }).catch(() => {});
}

module.exports = { checkForUpdate, downloadPackage, isNewer, parseMinerLine, sendReport, verifyManifest };
