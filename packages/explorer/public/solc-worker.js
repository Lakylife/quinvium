// Compiles Solidity in the visitor's browser with the official compiler from binaries.soliditylang.org.
// The page sends { url, sha256, input }: the compiler file is checked against the SHA-256 from the official build list
// before it runs, and the Standard JSON input is compiled locally. Nothing is sent anywhere; the result goes back to the page.
// A worker per compiler version: a compiler stays loaded for further compilations with the same version.
/* eslint-env worker */
let loaded = null;   // { url, compile }

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function load(url, sha256) {
  if (loaded?.url === url) return loaded.compile;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`compiler download failed: ${res.status}`);
  const bytes = await res.arrayBuffer();
  const got = hex(await crypto.subtle.digest('SHA-256', bytes));
  if (got !== String(sha256).replace(/^0x/, '').toLowerCase()) throw new Error('the compiler file does not match its published SHA-256');
  // The compiler defines a global Module; it starts as soon as the script runs.
  const ready = new Promise((resolve) => { self.Module = { onRuntimeInitialized: resolve }; });
  const blob = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  try { importScripts(blob); } finally { URL.revokeObjectURL(blob); }
  if (!self.Module.calledRun) await ready;
  const M = self.Module;
  const fn = M.cwrap('solidity_compile', 'string', ['string', 'number', 'number']);
  loaded = { url, compile: (input) => fn(input, 0, 0) };
  return loaded.compile;
}

self.onmessage = async ({ data }) => {
  try {
    const compile = await load(data.url, data.sha256);
    self.postMessage({ id: data.id, output: compile(JSON.stringify(data.input)) });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message ?? String(e) });
  }
};
