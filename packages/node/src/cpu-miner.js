#!/usr/bin/env node
// CPU miner for the Quinvium testnet: keeps blocks coming when no graphics card mines the testnet.
// Usage: node src/cpu-miner.js --key-file <file> [--stratum 127.0.0.1:3334] [--dag-dir <folder>] [--worker cpu]
// Limit its CPU with the service manager (ops/systemd/quinvium-testnet-miner.service).
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { privateToAddress } from '@ethereumjs/util';
import { CpuMiner } from './mining/cpuminer.js';
import { fromHex, toHex } from './util/bytes.js';

const { values: v } = parseArgs({
  options: {
    stratum: { type: 'string', default: '127.0.0.1:3334' },
    address: { type: 'string' },
    'key-file': { type: 'string' },
    'dag-dir': { type: 'string' },
    worker: { type: 'string', default: 'cpu' },
    help: { type: 'boolean' },
  },
});

if (v.help || (!v.address && !v['key-file'])) {
  console.log(`Quinvium CPU miner for the testnet
  --stratum <host:port>   Stratum of the testnet node (default 127.0.0.1:3334)
  --address <0x...>       payout address
  --key-file <file>       or: payout key, created on first start; the address is derived from it
  --dag-dir <folder>      keep the DAG (about 1 GB) between restarts
  --worker <name>         device name (default cpu)`);
  process.exit(v.help ? 0 : 1);
}

let address = v.address;
if (!address) {
  const file = v['key-file'];
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `0x${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  }
  address = toHex(privateToAddress(fromHex(readFileSync(file, 'utf8').trim())));
}
if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
  console.error('Invalid payout address');
  process.exit(1);
}

const [host, port] = v.stratum.split(':');
const time = () => new Date().toISOString().slice(11, 19);
const miner = new CpuMiner({ host, port: Number(port), address, worker: v.worker, dagDir: v['dag-dir'] ?? null, log: (l) => console.log(`${time()} ${l}`) });
console.log(`${time()} Payout address ${address}`);
miner.start();
const stop = () => { miner.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
