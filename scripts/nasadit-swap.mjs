#!/usr/bin/env node
// Deploys Swap: factory and router. It creates no tokens or pools; those are created by token authors and liquidity providers.
// Usage: node scripts/nasadit-swap.mjs <rpc> <phrase file> [factory nonce]
// The phrase is never printed. Run nasadit-tokeny.mjs first.
// The contract address depends only on the nonce. On testnet the factory was at nonce 15 and the router at 16 (0xfee4…1E95, hardcoded in apps
// like Wpayin): with argument 15 the script fills missing nonces with empty transfers to itself and the addresses stay the same.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const [rpc, phraseFile, wantNonce] = process.argv.slice(2);
if (!rpc || !phraseFile || (wantNonce !== undefined && !/^\d+$/.test(wantNonce))) throw new Error('Použití: nasadit-swap.mjs <rpc> <soubor s frází> [nonce factory]');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = JSON.parse(readFileSync(join(root, 'packages/contracts/dist/artifacts.json')));
const output = join(root, 'packages/explorer/public/deployments.json');
const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true, cacheTimeout: -1 });
const words = /(?:\b[a-z]+\b\s+){11,23}\b[a-z]+\b/.exec(readFileSync(phraseFile, 'utf8'));
if (!words) throw new Error('V souboru není fráze peněženky');
const wallet = ethers.Wallet.fromPhrase(words[0].trim().replace(/\s+/g, ' '), provider);
const { chainId } = await provider.getNetwork();
const all = JSON.parse(readFileSync(output, 'utf8'));
const here = all[chainId.toString()] ?? {};
if (!here.registry) throw new Error('Nejdřív spusťte nasadit-tokeny.mjs');

async function deploy(name, ...args) {
  const contract = await new ethers.ContractFactory(artifacts[name].abi, artifacts[name].bytecode, wallet).deploy(...args);
  await contract.waitForDeployment();
  console.log(`${name}: ${contract.target}`);
  return contract;
}

if (wantNonce !== undefined) {
  const target = Number(wantNonce);
  let nonce = await provider.getTransactionCount(wallet.address, 'pending');
  if (nonce > target) throw new Error(`Nonce ${nonce} je už za ${target}, adresy by vyšly jinak`);
  for (; nonce < target; nonce += 1) await (await wallet.sendTransaction({ to: wallet.address, value: 0n, nonce })).wait();
}
const factory = await deploy('SwapFactory');
const router = await deploy('SwapRouter', factory.target, artifacts.WAET.address);
all[chainId.toString()] = { ...here, swap: { factory: factory.target, router: router.target, tokens: [] } };
writeFileSync(output, `${JSON.stringify(all, null, 2)}\n`);
console.log(`Zapsáno do ${output}`);
