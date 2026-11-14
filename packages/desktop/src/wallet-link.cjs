// Connecting the app to a wallet in a regular browser. MetaMask is a browser extension and cannot get into the app,
// so the app opens a local page that relays signature requests to the wallet. The keys stay in the wallet.
// The server listens only on 127.0.0.1 and every request must know the random token from the page address.
const crypto = require('node:crypto');
const http = require('node:http');

const PREFERRED_PORT = 18546;    // fixed port: MetaMask remembers the permission by the page address
const POLL_MS = 20_000;
const ALIVE_MS = 30_000;
const ANSWER_MS = 300_000;
const MAX_BODY = 1 << 20;

const TEXTS = {
  en: { title: 'Connect your wallet to Quinvium', pick: 'Choose a wallet in this browser.', none: 'No wallet found in this browser. Install MetaMask and reload this page.', asking: 'Confirm the request in your wallet.', ready: 'Connected. Keep this tab open, the Quinvium app sends signature requests through it.', closed: 'The Quinvium app is closed.', failed: 'That did not work' },
  cs: { title: 'Připojte peněženku k Quinviu', pick: 'Vyberte peněženku v tomto prohlížeči.', none: 'V tomto prohlížeči není žádná peněženka. Nainstalujte MetaMask a stránku obnovte.', asking: 'Potvrďte žádost v peněžence.', ready: 'Připojeno. Nechte tuto kartu otevřenou, aplikace Quinvium přes ni posílá žádosti o podpis.', closed: 'Aplikace Quinvium je zavřená.', failed: 'Nepovedlo se' },
  de: { title: 'Wallet mit Quinvium verbinden', pick: 'Wählen Sie eine Wallet in diesem Browser.', none: 'Keine Wallet in diesem Browser gefunden. Installieren Sie MetaMask und laden Sie die Seite neu.', asking: 'Bestätigen Sie die Anfrage in Ihrer Wallet.', ready: 'Verbunden. Lassen Sie diesen Tab offen, die Quinvium-App sendet darüber Signaturanfragen.', closed: 'Die Quinvium-App ist geschlossen.', failed: 'Das hat nicht geklappt' },
  es: { title: 'Conecte su monedero a Quinvium', pick: 'Elija un monedero en este navegador.', none: 'No hay ningún monedero en este navegador. Instale MetaMask y recargue la página.', asking: 'Confirme la solicitud en su monedero.', ready: 'Conectado. Deje esta pestaña abierta, la app Quinvium envía por ella las solicitudes de firma.', closed: 'La app Quinvium está cerrada.', failed: 'No ha funcionado' },
  fr: { title: 'Connectez votre portefeuille à Quinvium', pick: 'Choisissez un portefeuille dans ce navigateur.', none: 'Aucun portefeuille dans ce navigateur. Installez MetaMask et rechargez la page.', asking: 'Confirmez la demande dans votre portefeuille.', ready: 'Connecté. Laissez cet onglet ouvert, l’app Quinvium y envoie les demandes de signature.', closed: 'L’app Quinvium est fermée.', failed: 'Cela n’a pas fonctionné' },
};

// The page runs in the browser. It loads nothing from the internet and talks only to the app and the wallet.
const PAGE_SCRIPT = String.raw`
const T = JSON.parse(document.getElementById('texts').textContent);
const base = location.pathname;
const text = document.getElementById('text');
const list = document.getElementById('list');
const problem = document.getElementById('problem');
const found = new Map();
let config = null;
let provider = null;
let account = null;
const api = (path, body) => fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
const hex = (s) => '0x' + [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function network() {
  const chain = config.chain;
  const chainId = '0x' + chain.chainId.toString(16);
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (e) {
    if (e.code !== 4902 && e.data?.originalError?.code !== 4902) throw e;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: chain.name, rpcUrls: [chain.rpc], nativeCurrency: { name: 'Quinvium', symbol: chain.symbol, decimals: 18 } }] });
  }
}

async function serve() {
  list.replaceChildren();
  text.textContent = T.ready;
  for (;;) {
    let r;
    try { r = await api('next'); } catch { text.textContent = T.closed; return; }
    if (r.status !== 200) continue;
    const q = await r.json();
    text.textContent = T.asking;
    try {
      if (q.method === 'eth_sendTransaction') await network();
      const result = await provider.request({ method: q.method, params: q.params });
      await api('answer', { id: q.id, result });
    } catch (e) {
      await api('answer', { id: q.id, error: { code: e.code, message: e.message } });
    }
    text.textContent = T.ready;
  }
}

async function connect(detail) {
  problem.textContent = '';
  provider = detail.provider;
  text.textContent = T.asking;
  try {
    const [address] = await provider.request({ method: 'eth_requestAccounts' });
    account = address;
    if (!config.signedIn) {
      await network();
      const signature = await provider.request({ method: 'personal_sign', params: [hex(config.message), address] });
      await api('hello', { address, signature, name: detail.info?.name ?? 'Wallet', rdns: detail.info?.rdns ?? null });
    }
    await serve();
  } catch (e) {
    problem.textContent = T.failed + ': ' + e.message;
    draw();
  }
}

function draw() {
  if (account) return;
  const wallets = [...found.values()];
  text.textContent = wallets.length ? T.pick : T.none;
  list.replaceChildren(...wallets.map((detail) => {
    const b = document.createElement('button');
    b.textContent = detail.info?.name ?? 'Wallet';
    b.onclick = () => connect(detail);
    return b;
  }));
}

addEventListener('eip6963:announceProvider', async (e) => {
  found.set(e.detail.info.rdns, e.detail);
  draw();
  if (config?.signedIn && config.rdns === e.detail.info.rdns && !account) connect(e.detail);
});
(async () => {
  config = await (await api('config')).json();
  dispatchEvent(new Event('eip6963:requestProvider'));
  setTimeout(() => {
    if (!found.size && window.ethereum) found.set('injected', { provider: window.ethereum, info: { name: window.ethereum.isMetaMask ? 'MetaMask' : 'Wallet', rdns: 'injected' } });
    draw();
    if (config.signedIn && config.rdns === 'injected' && found.size) connect(found.get('injected'));
  }, 300);
})();
`;

const page = (lang, nonce) => {
  const texts = TEXTS[lang] ?? TEXTS.en;
  return `<!doctype html><html lang="${TEXTS[lang] ? lang : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quinvium</title>
<style nonce="${nonce}">:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1016;color:#e9eef4;font:15px/1.5 system-ui,sans-serif}main{width:min(420px,90vw);text-align:center}h1{margin:0 0 8px;font-size:24px;letter-spacing:-.01em}p{color:#a5b4c3}button{display:block;width:100%;margin-top:12px;padding:13px;border:0;border-radius:12px;background:#2f86d8;color:#fff;font:inherit;font-weight:600;cursor:pointer}#problem{color:#ef6a6a;overflow-wrap:anywhere}</style></head>
<body><main><h1>${texts.title}</h1><p id="text"></p><div id="list"></div><p id="problem"></p></main>
<script type="application/json" id="texts" nonce="${nonce}">${JSON.stringify(texts).replace(/</g, '\\u003c')}</script>
<script nonce="${nonce}">${PAGE_SCRIPT}</script></body></html>`;
};

class WalletLink {
  /**
   * @param {object} o
   * @param {(url: string) => void} o.open opens an address in the browser
   * @param {(hello: object) => void} o.onHello the wallet has signed in
   */
  constructor({ open, onHello }) {
    this.open = open;
    this.onHello = onHello;
    this.token = crypto.randomBytes(24).toString('hex');
    this.config = { signedIn: false };
    this.lang = 'en';
    this.queue = [];
    this.pending = new Map();
    this.poller = null;
    this.seen = 0;
    this.nextId = 1;
    this.server = null;
  }

  async listen() {
    if (this.server) return;
    const server = http.createServer((req, res) => { this.handle(req, res).catch(() => { res.writeHead(500); res.end(); }); });
    await new Promise((resolve, reject) => {
      server.once('error', (e) => {
        if (e.code !== 'EADDRINUSE') { reject(e); return; }
        server.listen(0, '127.0.0.1', resolve);    // the fixed port is taken; the wallet then just repeats the permission
      });
      server.listen(PREFERRED_PORT, '127.0.0.1', resolve);
    });
    this.server = server;
    this.server.unref();
    this.port = server.address().port;
  }

  get url() { return `http://127.0.0.1:${this.port}/${this.token}/`; }

  /** Opens the page for signing in or for further signatures. */
  async show({ lang, chain, signedIn = false, rdns = null }) {
    await this.listen();
    this.lang = lang ?? this.lang;
    Object.assign(this.config, { chain, signedIn, rdns, message: `Sign in to the Quinvium app\n${crypto.randomBytes(16).toString('hex')}` });
    this.open(this.url);
    return this.config.message;
  }

  /** Hands the request to the wallet. If the page is not open, it opens it again. */
  async request(method, params, config) {
    await this.listen();
    if (config) Object.assign(this.config, config);
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The wallet did not respond')); }, ANSWER_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.queue.push({ id, method, params });
      this.flush();
      if (Date.now() - this.seen > ALIVE_MS) this.open(this.url);
    });
  }

  flush() {
    if (!this.poller || !this.queue.length) return;
    const res = this.poller;
    this.poller = null;
    clearTimeout(res.timer);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(this.queue.shift()));
  }

  body(req) {
    return new Promise((resolve, reject) => {
      let text = '';
      req.setEncoding('utf8');
      req.on('data', (d) => { text += d; if (text.length > MAX_BODY) reject(new Error('příliš dlouhé')); });
      req.on('end', () => { try { resolve(JSON.parse(text)); } catch (e) { reject(e); } });
    });
  }

  async handle(req, res) {
    const self = `127.0.0.1:${this.port}`;
    const [, token, action] = (req.url ?? '').split('?')[0].split('/');
    // The Host header prevents an attack through a foreign domain pointing at 127.0.0.1; the token stops foreign pages on the same computer.
    if (req.headers.host !== self || token !== this.token) { res.writeHead(404); res.end(); return; }
    if (req.method === 'POST' && req.headers.origin !== `http://${self}`) { res.writeHead(403); res.end(); return; }
    if (req.method === 'GET' && !action) {
      const nonce = crypto.randomBytes(16).toString('base64');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'`,
      });
      res.end(page(this.lang, nonce));
      return;
    }
    if (req.method === 'GET' && action === 'config') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(this.config));
      return;
    }
    if (req.method === 'GET' && action === 'next') {
      this.seen = Date.now();
      this.poller?.writeHead(204).end();
      this.poller = res;
      res.timer = setTimeout(() => { if (this.poller === res) { this.poller = null; res.writeHead(204); res.end(); } }, POLL_MS);
      this.flush();
      return;
    }
    if (req.method === 'POST' && action === 'hello') {
      const hello = await this.body(req);
      this.seen = Date.now();
      this.onHello({ ...hello, message: this.config.message });
      this.config.signedIn = true;
      this.config.rdns = hello.rdns;
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && action === 'answer') {
      const { id, result, error } = await this.body(req);
      const waiting = this.pending.get(id);
      if (waiting) {
        this.pending.delete(id);
        clearTimeout(waiting.timer);
        if (error) waiting.reject(new Error(error.message ?? 'The wallet refused the request'));
        else waiting.resolve(result);
      }
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  }

  stop() {
    this.poller?.writeHead(204).end();
    this.server?.close();
    this.server = null;
  }
}

module.exports = { WalletLink };
