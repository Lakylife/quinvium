// Validátor mostu mezi EVM řetězci. Sleduje odeslání na každém řetězci, po dostatečném potvrzení podepíše zprávu
// a zveřejní podpis v cílové bráně. Jakmile je podpisů dost, doručení odešle kdokoli z validátorů.
//
// Podepisuje jen to, co sám viděl ve vlastním uzlu zdrojového řetězce. Validátor proto musí mít vlastní uzly, jinak
// přebírá důvěru v cizí server. Každý krok jde opakovat, takže výpadek uprostřed ničemu nevadí.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { ethers } from 'ethers';

const artifacts = JSON.parse(readFileSync(new URL('../../contracts/dist/artifacts.json', import.meta.url)));
export const GATEWAY_ABI = artifacts.BridgeGateway.abi;
const DOMAIN = ethers.id('AetherBridge.v1');
const LOG_BATCH = 2000;
const ATTEST_WINDOW = 9000;     // uzel Quinvium vrací logy z nejvýše 10 000 bloků najednou
const RESEND_MS = 60_000;

/**
 * Nejmenší počet potvrzení podle řetězce. Na malé síti s Proof of Work stojí přepis několika minut málo, stačí pronajatý
 * výkon, a stejné mince by šly mostem poslat dvakrát. Mainnet Quinvia proto čeká hodinu (pod hranicí finality 256 bloků),
 * Ethereum na finalitu dvou epoch. Testovací sítě mají jen obecné minimum.
 */
export const MIN_CONFIRMATIONS = Object.freeze({ 52401: 240, 1: 64 });
const coder = ethers.AbiCoder.defaultAbiCoder();

/** Stejný výpočet jako `messageId` v kontraktu, jen bez dotazu na cizí uzel. */
export function messageId(gateway, m) {
  return ethers.keccak256(coder.encode(
    ['bytes32', 'address', 'uint64', 'uint64', 'uint64', 'bytes32', 'address', 'uint256'],
    [DOMAIN, gateway, m.srcChain, m.dstChain, m.nonce, m.srcToken, m.recipient, m.amount],
  ));
}

/** Co validátor podepisuje: ID zprávy s předponou EIP-191, stejně jako to ověřuje brána. */
export const signedDigest = (id) => ethers.hashMessage(ethers.getBytes(id));

/** Klíč trasy jako v kontraktu: odkud a jaký token. */
export const routeKey = (chain, token) => ethers.keccak256(coder.encode(['uint64', 'bytes32'], [chain, token]));

/** Číslo zprávy odvozené z textu, stejně jako u vrácení na mostě do Bitcoinu. Skutečná čísla zpráv jdou od jedničky, s tímhle se nepotkají. */
export const nonceOf = (text) => BigInt(ethers.dataSlice(ethers.sha256(ethers.toUtf8Bytes(text)), 0, 8));

/**
 * Vrácení zrušeného převodu: zpráva opačným směrem, od cílové sítě zpět na zdrojovou, s původním odesílatelem jako příjemcem.
 * Číslo je odvozené z původního odeslání, takže jedno odeslání se nemůže vrátit dvakrát.
 * @param {object} message původní zpráva s `sender` a `sendId` z události Sent
 * @param {string} local token na cílové síti, na který trasa původní převod měnila
 */
export const refundMessage = (message, local) => ({
  srcChain: message.dstChain, dstChain: message.srcChain, nonce: nonceOf(`refund:${message.sendId}`),
  srcToken: ethers.zeroPadValue(local, 32), recipient: message.sender, amount: message.amount, refundOf: message.sendId,
});

/** Do kontraktu jdou jen pole zprávy, poznámky validátora ne. */
const wire = ({ srcChain, dstChain, nonce, srcToken, recipient, amount }) => ({ srcChain, dstChain, nonce, srcToken, recipient, amount });

/** Logy z delšího rozsahu po částech, uzly delší dotaz odmítají. */
export async function queryRange(contract, filter, from, to) {
  const found = [];
  for (let start = from; start <= to; start += LOG_BATCH) found.push(...await contract.queryFilter(filter, start, Math.min(start + LOG_BATCH - 1, to)));
  return found;
}

/** BigInt v JSON: hodnoty se ukládají jako text s předponou. */
const encode = (value) => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? `#${v}` : v));
const decode = (text) => JSON.parse(text, (_, v) => (typeof v === 'string' && /^#\d+$/.test(v) ? BigInt(v.slice(1)) : v));

/** Stav uložený atomicky, po pádu tedy nezůstane rozepsaný soubor. Podpis se bez zápisu stavu neodešle. */
export class StateFile {
  constructor(path) {
    this.path = path;
    this.data = {};
    if (!path) return;
    try { this.data = decode(readFileSync(path, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }

  save() {
    if (!this.path) return;
    writeFileSync(`${this.path}.tmp`, encode(this.data), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
}

export class Relayer {
  /**
   * @param {object} o
   * @param {{ id: bigint, name: string, provider: object, gateway: string, confirmations: number, startBlock?: number }[]} o.chains
   * @param {string} o.privateKey klíč validátora
   * @param {string} [o.statePath] soubor se stavem
   * @param {(line: string) => void} [o.log]
   */
  constructor({ chains, privateKey, statePath, log = () => {} }) {
    this.key = new ethers.SigningKey(privateKey);
    this.address = ethers.computeAddress(this.key);
    this.log = log;
    for (const c of chains) {
      const need = MIN_CONFIRMATIONS[Number(c.id)] ?? 1;
      if (!Number.isInteger(c.confirmations) || c.confirmations < need) {
        throw new Error(`${c.name}: potřeba je aspoň ${need} potvrzení, nastaveno ${c.confirmations}`);
      }
    }
    this.chains = new Map(chains.map((c) => {
      const signer = new ethers.Wallet(privateKey, c.provider);
      return [c.id, { ...c, signer, gateway: new ethers.Contract(c.gateway, GATEWAY_ABI, signer) }];
    }));
    this.state = new StateFile(statePath);
    this.state.data.cursor ??= {};
    this.state.data.pending ??= {};
    this.sent = new Map();     // co už je odeslané a čeká na blok
    this.running = false;
  }

  /** Zpráva z jiného zdroje než EVM brány, například vklad Bitcoinu. */
  enqueue(message) {
    const dst = this.chains.get(message.dstChain);
    if (!dst) throw new Error(`Neznámý cílový řetězec ${message.dstChain}`);
    const id = messageId(dst.gateway.target, message);
    if (!this.state.data.pending[id]) {
      this.state.data.pending[id] = message;
      this.state.save();
    }
    return id;
  }

  /** Jeden průchod. Chyba jednoho řetězce nezastaví ostatní, zkusí se to příště znovu. */
  async tick() {
    for (const chain of this.chains.values()) {
      try { await this.scan(chain); } catch (e) { this.log(`${chain.name}: čtení selhalo: ${e.shortMessage ?? e.message}`); }
    }
    for (const [id, message] of Object.entries(this.state.data.pending)) {
      try { await this.handle(id, message); } catch (e) { this.log(`${id.slice(0, 10)}: ${e.shortMessage ?? e.message}`); }
    }
  }

  /** Zprávy se berou až z bloků s dostatečným potvrzením, přeskupení řetězce je tak nemůže podstrčit. */
  async scan(chain) {
    const safe = await chain.provider.getBlockNumber() - chain.confirmations;
    const key = chain.id.toString();
    let from = this.state.data.cursor[key] ?? chain.startBlock ?? 0;
    while (from <= safe) {
      const to = Math.min(from + LOG_BATCH - 1, safe);
      for (const log of await chain.gateway.queryFilter('Sent', from, to)) this.accept(chain, log);
      from = to + 1;
      this.state.data.cursor[key] = from;
      this.state.save();
    }
  }

  accept(chain, log) {
    const { id: sendId, dstChain, token, sender, recipient, amount, nonce } = log.args;
    const dst = this.chains.get(dstChain);
    if (!dst) return;       // Bitcoin a řetězce, které tento validátor nesleduje
    if (ethers.dataLength(recipient) !== 20) {
      this.log(`${chain.name}: zpráva ${nonce} nemá adresu příjemce, přeskakuji`);
      return;
    }
    // Odesílatel a číslo odeslání patří ke zprávě kvůli vrácení: zrušený převod jde zpět právě jemu.
    const message = { srcChain: chain.id, dstChain, nonce, srcToken: ethers.zeroPadValue(token, 32), recipient: ethers.getAddress(recipient), amount, sender: ethers.getAddress(sender), sendId };
    const id = messageId(dst.gateway.target, message);
    if (!this.state.data.pending[id]) this.state.data.pending[id] = message;
  }

  once(key) {
    const at = this.sent.get(key);
    if (at && Date.now() - at < RESEND_MS) return false;
    this.sent.set(key, Date.now());
    return true;
  }

  async handle(id, message) {
    const dst = this.chains.get(message.dstChain);
    if (await dst.gateway.delivered(id)) { this.finish(id); return; }
    const queue = await dst.gateway.queued(id);
    if (queue.readyAt !== 0n) {
      if (queue.done) { await this.refund(id, message, dst); return; }
      const { timestamp } = await dst.provider.getBlock('latest');
      if (BigInt(timestamp) >= queue.readyAt && this.once(`queue-${id}`)) await dst.gateway.executeQueued(wire(message));
      return;
    }
    const signatures = await this.signatures(dst, id);
    if (!signatures.has(this.address) && this.once(`attest-${id}`)) {
      const signature = this.key.sign(signedDigest(id)).serialized;
      await dst.gateway.attest(id, signature);
      signatures.set(this.address, signature);
    }
    const threshold = Number(await dst.gateway.threshold());
    if (signatures.size >= threshold && this.once(`deliver-${id}`)) {
      const ordered = [...signatures.entries()].sort(([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : 1)).slice(0, threshold).map(([, s]) => s);
      await dst.gateway.deliver.staticCall(wire(message), ordered);
      await dst.gateway.deliver(wire(message), ordered);
      this.log(`${id.slice(0, 10)}: doručuji ${message.amount} na ${message.recipient}`);
    }
  }

  /**
   * Zrušený převod se vrátí odesílateli na zdrojové síti, stejnou cestou jako převod opačným směrem.
   * Vrácení přijde na řadu, až je zrušení dost hluboko v cílovém řetězci: přeskupení by ho jinak mohlo vzít zpět
   * a mince by dorazily dvakrát. Zrušené doručení už nikdy neprojde, to hlídá brána, a vrácení má číslo
   * odvozené z odeslání, takže projde nejvýš jednou.
   */
  async refund(id, message, dst) {
    const safe = await dst.provider.getBlockNumber() - dst.confirmations;
    if (safe < 0) return;
    const [queue, done] = await Promise.all([dst.gateway.queued(id, { blockTag: safe }), dst.gateway.delivered(id, { blockTag: safe })]);
    if (!queue.done || done) return;
    const src = this.chains.get(message.srcChain);
    if (!src || !message.sender || message.sendId === undefined) {
      // Vklad z Bitcoinu nebo samo vrácení: odesílatel na této straně není, vrácení musí obstarat jejich vlastní cesta.
      this.log(`${id.slice(0, 10)}: zrušeno, vrácení tento validátor neobslouží`);
      this.finish(id);
      return;
    }
    const route = await dst.gateway.routes(routeKey(message.srcChain, message.srcToken));
    const back = refundMessage(message, route.local);
    const reverse = await src.gateway.routes(routeKey(back.srcChain, back.srcToken));
    if (!reverse.enabled) {
      this.log(`${id.slice(0, 10)}: zrušeno, ale zpáteční trasa je zavřená, zkusím to znovu`);
      return;
    }
    this.enqueue(back);
    this.log(`${id.slice(0, 10)}: zrušeno, vracím ${message.amount} odesílateli ${message.sender}`);
    this.finish(id);
  }

  async signatures(dst, id) {
    const head = await dst.provider.getBlockNumber();
    const from = Math.max(dst.startBlock ?? 0, head - ATTEST_WINDOW);
    const logs = await dst.gateway.queryFilter(dst.gateway.filters.Attested(id), from, head);
    const found = new Map();
    // Kontrakt podpis ověřil při zveřejnění, ale uzel je cizí vstup. Co nesouhlasí, doručení by odmítlo.
    for (const log of logs) {
      if (ethers.recoverAddress(signedDigest(id), log.args.signature) === log.args.validator && await dst.gateway.isValidator(log.args.validator)) found.set(log.args.validator, log.args.signature);
    }
    return found;
  }

  finish(id) {
    delete this.state.data.pending[id];
    this.state.save();
  }

  start(pollMs = 5000) {
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      await this.tick();
      this.timer = setTimeout(loop, pollMs);
    };
    loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }
}
