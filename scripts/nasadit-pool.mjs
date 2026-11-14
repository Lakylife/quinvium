#!/usr/bin/env node
// Creates a pool on the network and tops up the account that pays gas for shares. Testnet only.
// Usage: node scripts/nasadit-pool.mjs <rpc> <phrase file> <pool server address> <gas account>
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const [rpc, phraseFile, url, payer] = process.argv.slice(2);
if (!rpc || !phraseFile || !url || !ethers.isAddress(payer ?? '')) throw new Error('Použití: nasadit-pool.mjs <rpc> <soubor s frází> <adresa serveru> <účet na gas>');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = JSON.parse(readFileSync(join(root, 'packages/contracts/dist/artifacts.json')));
const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true, cacheTimeout: -1 });
const words = /(?:\b[a-z]+\b\s+){11,23}\b[a-z]+\b/.exec(readFileSync(phraseFile, 'utf8'));
const wallet = ethers.Wallet.fromPhrase(words[0].trim().replace(/\s+/g, ' '), provider);
const factory = new ethers.Contract(artifacts.PoolFactory.address, artifacts.PoolFactory.abi, wallet);
const receipt = await (await factory.createPool('Quinvium Test Pool', url, 100, 32, 16)).wait();
const log = receipt.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((l) => l?.name === 'PoolCreated');
console.log(`Pool ${log.args.pool}, blok ${receipt.blockNumber}`);
await (await wallet.sendTransaction({ to: payer, value: ethers.parseEther('20') })).wait();
console.log(`Účet na gas ${payer} dobitý`);
