// Common base of commands: connection to the node, contracts, user prompts and output for people and scripts.
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { NETWORKS } from '../../node/src/params.js';
import contracts from '../../explorer/public/contracts.json' with { type: 'json' };
import bundled from '../../explorer/public/deployments.json' with { type: 'json' };
import { ERRORS } from './errors.js';
import { L } from './i18n.js';

/** An error the user fixes themselves. Printed without a stack trace. */
export class CliError extends Error {}

export const DEFAULT_NETWORK = 'testnet';
const SECOND = 1000;
export const TX_WAIT_MS = 180 * SECOND;
export const SWAP_DEADLINE_S = 1200;

export const toJson = (value) => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

/** The node returns addresses in checksum form; contracts.json has them in lower case. */
export const sameAddress = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

const coder = ethers.AbiCoder.defaultAbiCoder();
const interfaces = Object.values(contracts).filter((c) => c.abi).map((c) => new ethers.Interface(c.abi));

/** Name of the called function according to the network contracts' ABI, like the Method column in the Explorer. */
export function methodOf(x) {
  if (!x.to) return L('nasazení kontraktu', 'contract creation');
  const input = x.input ?? x.data ?? '0x';
  if (input === '0x') return L('převod', 'transfer');
  for (const i of interfaces) {
    try {
      const f = i.getFunction(input.slice(0, 10));
      if (f) return f.name;
    } catch { /* another contract */ }
  }
  return input.slice(0, 10);
}

/** What the contract returned on rejection: a custom error by ABI ({name, args}), text from require or a Panic code ({text}). */
export function revertInfo(data) {
  if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return null;
  try {
    if (data.startsWith('0x08c379a0')) return { name: 'Error', text: coder.decode(['string'], `0x${data.slice(10)}`)[0] };
    if (data.startsWith('0x4e487b71')) return { name: 'Panic', text: `Panic 0x${coder.decode(['uint256'], `0x${data.slice(10)}`)[0].toString(16)}` };
  } catch { /* corrupted data */ }
  for (const i of interfaces) {
    try {
      const e = i.parseError(data);
      if (e) return { name: e.name, args: [...e.args] };
    } catch { /* another contract */ }
  }
  return null;
}

/** The reason for rejection as a sentence. A known error gets an explanation and its code in brackets. */
export function revertReason(data) {
  const info = revertInfo(data);
  if (!info) return null;
  if (info.text) return info.text;
  const known = ERRORS[info.name];
  if (known) return `${L(known[0], known[1])} (${info.name})`;
  return info.args.length ? `${info.name}(${info.args.map(String).join(', ')})` : info.name;
}

/** The text from ethers contains the whole request. The user only cares about the reason. */
export function reason(e) {
  const decoded = revertReason(e?.data ?? e?.info?.error?.data ?? e?.error?.data);
  if (decoded) return decoded;
  const inner = e?.info?.error?.message ?? e?.error?.message;
  return e?.reason ?? inner ?? e?.shortMessage ?? e?.message ?? String(e);
}

export const parseAmount = (text, decimals = 18) => {
  const clean = String(text).trim().replace(',', '.');
  if (!/^\d*\.?\d+$/.test(clean)) throw new CliError(L(`Neplatná částka: ${text}`, `Invalid amount: ${text}`));
  try {
    return ethers.parseUnits(clean, decimals);
  } catch {
    throw new CliError(L(`Částka ${text} má příliš mnoho desetinných míst, token jich má ${decimals}.`, `The amount ${text} has too many decimals, the token has ${decimals}.`));
  }
};

/** A positive integer: the number of an item, deal, poll or proposal. */
export const parseId = (text, what) => {
  if (!/^\d+$/.test(String(text ?? '').trim())) throw new CliError(L(`Zadejte ${what.cs}, celé číslo.`, `Give the ${what.en} as a whole number.`));
  return BigInt(String(text).trim());
};

/** Fingerprint as in the Explorer: a value of 0x and 64 characters is taken as is, other text goes through keccak256. */
export const hashOf = (text) => (/^0x[0-9a-fA-F]{64}$/.test(String(text)) ? String(text).toLowerCase() : ethers.id(String(text)));

export const units = (value, decimals = 18, digits = 8) => {
  const [whole, frac = ''] = ethers.formatUnits(value, decimals).split('.');
  const shown = frac.slice(0, digits).replace(/0+$/, '');
  return shown ? `${whole}.${shown}` : whole;
};
export const gwei = (wei) => units(wei, 9, 3);

/** A non-zero amount must not look like zero: "< 0.0001" is shown instead of 0. */
export const amountText = (value, decimals = 18, digits = 8) => {
  const text = units(value, decimals, digits);
  return text === '0' && BigInt(value) > 0n ? `< 0.${'0'.repeat(digits - 1)}1` : text;
};

/** Price with significant digits as in the Explorer: 0.000000008 stays visible, larger numbers have at most `digits` decimals. */
export const significant = (value, decimals = 18, digits = 6) => {
  const [whole, frac = ''] = ethers.formatUnits(value, decimals).split('.');
  if (whole !== '0') return units(value, decimals, digits);
  const first = frac.search(/[1-9]/);
  return first < 0 ? '0' : `0.${frac.slice(0, first + digits).replace(/0+$/, '')}`;
};

/** Czech: 1 transakce, 2 to 4 transakce, 0 and 5 or more transakcí. */
export const plural = (n, one, few, many) => {
  const v = Math.abs(Number(n));
  return `${n} ${v === 1 ? one : v >= 2 && v <= 4 ? few : many}`;
};

/** A count with a noun in both languages: count(3, ['transakce', 'transakce', 'transakcí'], ['transaction', 'transactions']). */
export const count = (n, cs, en) => L(plural(n, ...cs), `${n} ${Math.abs(Number(n)) === 1 ? en[0] : en[1]}`);

export function rate(h) {
  let v = Number(h);
  for (const unit of ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s']) {
    if (v < 1000) return `${v.toFixed(2)} ${unit}`;
    v /= 1000;
  }
  return `${v.toFixed(2)} PH/s`;
}

export function ago(seconds) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(seconds)));
  const [n, unit] = s < 60 ? [s, 's'] : s < 3600 ? [Math.floor(s / 60), 'min'] : s < 86400 ? [Math.floor(s / 3600), 'h'] : [Math.floor(s / 86400), 'd'];
  return L(`před ${n} ${unit}`, `${n} ${unit} ago`);
}

/** Date and time from the block timestamp. */
export const dateText = (seconds) => new Date(Number(seconds) * 1000).toLocaleString(L('cs-CZ', 'en-GB'), { dateStyle: 'medium', timeStyle: 'medium' });

export const short = (a) => (a && a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a ?? '—');
export const yesNo = (v) => (v ? L('ano', 'yes') : L('ne', 'no'));

/** Columns aligned to the longest value. Numbers go to the right. */
export function table(head, rows, right = []) {
  const width = head.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (r) => r.map((c, i) => (right.includes(i) ? String(c ?? '').padStart(width[i]) : String(c ?? '').padEnd(width[i]))).join('  ').trimEnd();
  return [line(head), line(width.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

export const pairs = (rows) => {
  const shown = rows.filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== false);
  const width = Math.max(...shown.map(([k]) => k.length));
  return shown.map(([k, v]) => `${`${k}:`.padEnd(width + 2)}${v}`).join('\n');
};

// ------------------------------------------------------------------- questions to the user
const isTerminal = () => !!process.stdin.isTTY;

/** Without a terminal one line is read from input, so a secret can be passed by a script through a pipe, not an argument. */
let piped = null;
async function readLine() {
  if (piped === null) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    piped = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  }
  return piped.shift() ?? '';
}

export function ask(prompt) {
  if (!isTerminal()) return readLine();
  process.stderr.write(prompt);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (text) => { process.stdin.pause(); resolve(String(text).split(/\r?\n/)[0]); });
  });
}

/** Hidden input: characters are not echoed to the screen and do not stay in the command history. */
export function askHidden(prompt) {
  if (!isTerminal()) return readLine();
  const { stdin, stderr } = process;
  stderr.write(prompt);
  return new Promise((resolve, reject) => {
    let text = '';
    const finish = (done) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stderr.write('\n');
      done();
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') { finish(() => resolve(text)); return; }
        if (ch === '\u0003') { finish(() => reject(new CliError(L('Zrušeno.', 'Cancelled.')))); return; }
        if (ch === '\u007f' || ch === '\b') text = text.slice(0, -1);
        else text += ch;
      }
    };
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

// ------------------------------------------------------------------- connection
export class Context {
  /** @param {object} opts command-line options */
  constructor(opts) {
    this.opts = opts;
    this.networkName = opts.network ?? DEFAULT_NETWORK;
    this.network = NETWORKS[this.networkName];
    if (!this.network) throw new CliError(L(`Neznámá síť ${this.networkName}, zvolte mainnet, testnet nebo dev.`, `Unknown network ${this.networkName}, choose mainnet, testnet or dev.`));
    this.url = opts.rpc ?? `http://127.0.0.1:${this.network.ports.rpc}`;
    this.symbol = this.network.currency;
    this.chainId = Number(this.network.chainId);
    this.contracts = contracts;
  }

  /** Output for a person, or with --json for a script. */
  print(data, text) {
    console.log(this.opts.json ? toJson(data) : text ?? toJson(data));
  }

  note(text) {
    if (!this.opts.json) console.log(text);
  }

  async rpc(method, params = []) {
    const res = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      .catch(() => {
        throw new CliError(L(`Uzel ${this.url} neodpovídá. Spusťte aplikaci Quinvium nebo příkaz: quinvium node --network ${this.networkName}`,
          `The node at ${this.url} does not respond. Start the Quinvium app or run: quinvium node --network ${this.networkName}`));
      });
    const body = await res.json();
    if (body.error) throw new CliError(body.error.message);
    return body.result;
  }

  /** The network is checked before signing. A signature for another network would be valid there, it would just go somewhere the user does not expect. */
  async connect() {
    if (this.provider) return this.provider;
    const chainId = Number(await this.rpc('eth_chainId'));
    if (chainId !== this.chainId) {
      throw new CliError(L(`Uzel ${this.url} je na síti ${chainId}, ne na ${this.networkName} (${this.chainId}). Zvolte správnou síť přes --network.`,
        `The node at ${this.url} is on network ${chainId}, not ${this.networkName} (${this.chainId}). Choose the right network with --network.`));
    }
    this.chainId = chainId;
    this.provider = new ethers.JsonRpcProvider(this.url, chainId, { staticNetwork: true, pollingInterval: SECOND });
    return this.provider;
  }

  at(name, address, runner) {
    const c = contracts[name];
    return new ethers.Contract(address ?? c.address, c.abi, runner ?? this.provider);
  }

  /** Bridge and Swap addresses: an own file, or those the tool was released with, supplemented by new ones from the node. */
  async deployment() {
    if (this.deployed !== undefined) return this.deployed;
    if (this.opts.deployments) {
      this.deployed = JSON.parse(readFileSync(this.opts.deployments, 'utf8'))[this.chainId] ?? null;
      return this.deployed;
    }
    // Addresses from the release take precedence: a foreign node could otherwise plant a fake router and get tokens approved for it.
    const remote = await fetch(`${this.url}/deployments.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const merged = { ...remote?.[this.chainId], ...bundled[this.chainId] };
    this.deployed = Object.keys(merged).length ? merged : null;
    return this.deployed;
  }

  native() {
    return { native: true, address: contracts.WAET.address, symbol: this.symbol, name: 'Quinvium', decimals: 18, verified: true };
  }

  isNative(text) {
    return /^(native|quinvium|quintium|[dt]?qu)$/i.test(text) || text.toLowerCase() === this.symbol.toLowerCase();
  }

  /** The verified list from the network. A token outside it can be used only by address, and the output warns about it. */
  async tokens() {
    if (this.tokenList) return this.tokenList;
    await this.connect();
    const d = await this.deployment();
    const found = new Map();
    const add = async (address, verified, extra = {}) => {
      if (found.has(address.toLowerCase())) return;
      const c = this.at('AetherToken', address);
      const [symbol, name, decimals] = await Promise.all([c.symbol(), c.name(), c.decimals()]);
      found.set(address.toLowerCase(), { address, symbol, name, decimals: Number(decimals), verified, ...extra });
    };
    if (d?.registry) {
      const entries = await this.at('TokenRegistry', d.registry).all();
      await Promise.all(entries.map((e) => add(e.token, true, { kind: Number(e.kind), issuer: e.issuer }).catch(() => {})));
    }
    await Promise.all((d?.swap?.tokens ?? []).map((t) => add(t.address, !d?.registry).catch(() => {})));
    // Tokens with a pool against QU from the Swap factory: authors create them themselves; a fixed list does not know them. At most the 200 newest pools are taken.
    if (d?.swap?.factory) {
      const hub = this.contracts.WAET.address.toLowerCase();
      const factory = this.at('SwapFactory', d.swap.factory);
      const total = Number(await factory.allPairsLength().catch(() => 0n));
      const start = Math.max(0, total - 200);
      const pairs = total > start ? [...await factory.list(start, total - start).catch(() => [])] : [];
      await Promise.all(pairs.map(async (address) => {
        const pair = this.at('SwapPair', address);
        const [t0, t1] = await Promise.all([pair.token0(), pair.token1()]);
        const other = t0.toLowerCase() === hub ? t1 : t1.toLowerCase() === hub ? t0 : null;
        if (other) await add(other, false);
      }).map((p) => p.catch(() => {})));
    }
    this.tokenList = [...found.values()];
    return this.tokenList;
  }

  async token(text) {
    if (this.isNative(text)) return this.native();
    const list = await this.tokens();
    if (ethers.isAddress(text)) {
      const known = list.find((t) => sameAddress(t.address, text));
      if (known) return known;
      const c = this.at('AetherToken', text);
      const meta = await Promise.all([c.symbol(), c.name(), c.decimals()]).catch(() => { throw new CliError(L(`Na adrese ${text} není token.`, `There is no token at ${text}.`)); });
      return { address: ethers.getAddress(text), symbol: meta[0], name: meta[1], decimals: Number(meta[2]), verified: false };
    }
    const hits = list.filter((t) => t.symbol.toLowerCase() === text.toLowerCase());
    if (!hits.length) throw new CliError(L(`Token ${text} není na ověřeném seznamu. Tokeny zobrazí: quinvium tokens`, `Token ${text} is not on the verified list. See the tokens: quinvium tokens`));
    return hits[0];
  }

  /** An address, or a .qu name from the name registry. */
  async address(text) {
    if (ethers.isAddress(text ?? '')) return ethers.getAddress(text);
    if (/\.qu$/i.test(text ?? '')) {
      await this.connect();
      const name = text.slice(0, -3).toLowerCase();
      const target = await this.at('AetherNames').resolve(name).catch(() => ethers.ZeroAddress);
      if (target === ethers.ZeroAddress) throw new CliError(L(`Jméno ${text} není zaregistrované.`, `The name ${text} is not registered.`));
      return target;
    }
    throw new CliError(L(`Neplatná adresa: ${text ?? '(chybí)'}`, `Invalid address: ${text ?? '(missing)'}`));
  }

  feeTier() {
    const tier = this.opts.fee ?? 'normal';
    if (!['slow', 'normal', 'fast'].includes(tier)) throw new CliError(L('Poplatek --fee může být slow, normal nebo fast.', 'The fee --fee can be slow, normal or fast.'));
    return tier;
  }
}
