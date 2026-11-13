#!/usr/bin/env node
// Spuštění validátora mostu: node packages/bridge/src/cli.js <nastavení.json>
// Vzor nastavení je v config.example.json. Klíče jsou v samostatných souborech s právy jen pro vlastníka.
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ethers } from 'ethers';
import { Relayer } from './relayer.js';
import { BitcoinBridge, bitcoinRpc } from './btc-bridge.js';

const POLL_MS = 15_000;
const path = process.argv[2];
if (!path) {
  console.error('Použití: aether-bridge <nastavení.json>');
  process.exit(1);
}
const config = JSON.parse(readFileSync(path, 'utf8'));
const base = dirname(resolve(path));
const log = (line) => console.log(`${new Date().toISOString()} ${line}`);

function secret(file) {
  const full = resolve(base, file);
  if (process.platform !== 'win32' && statSync(full).mode & 0o077) throw new Error(`Soubor ${file} smí číst jen vlastník (chmod 600)`);
  return readFileSync(full, 'utf8').trim();
}

const chains = config.chains.map((c) => ({
  id: BigInt(c.id), name: c.name, gateway: c.gateway, confirmations: c.confirmations, startBlock: c.startBlock ?? 0,
  provider: new ethers.JsonRpcProvider(c.rpc, undefined, { staticNetwork: ethers.Network.from(Number(c.id)), cacheTimeout: -1 }),
}));
const relayer = new Relayer({ chains, privateKey: secret(config.keyFile), statePath: resolve(base, config.stateFile ?? 'most-stav.json'), log });
let bitcoin = null;
if (config.bitcoin) {
  const b = config.bitcoin;
  bitcoin = new BitcoinBridge({
    rpc: bitcoinRpc(b.rpc, { user: b.user, password: b.passwordFile ? secret(b.passwordFile) : undefined }), network: b.network, relayer, chainId: BigInt(b.chainId), token: b.token,
    btcKey: secret(b.keyFile), validators: b.validators, threshold: b.threshold, confirmations: b.confirmations, minDeposit: BigInt(b.minDeposit ?? 10_000),
    maxFeeRate: b.maxFeeRate, dailyLimit: BigInt(b.dailyLimit ?? 1_000_000_000), statePath: resolve(base, b.stateFile ?? 'most-bitcoin.json'), log,
  });
  log(`Úschova Bitcoinu: ${bitcoin.mainAddress}`);
}

let stopping = false;
async function loop() {
  while (!stopping) {
    if (bitcoin) await bitcoin.tick().catch((e) => log(`Bitcoin: ${e.message}`));
    await relayer.tick();
    await new Promise((r) => { setTimeout(r, config.pollMs ?? POLL_MS); });
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; process.exit(0); });
log(`Validátor ${relayer.address} běží: ${chains.map((c) => c.name).join(', ')}`);
loop();
