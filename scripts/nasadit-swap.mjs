#!/usr/bin/env node
// Nasadí Swap: factory a router. Tokeny ani pooly nezakládá, ty vytvářejí autoři tokenů a poskytovatelé likvidity.
// Použití: node scripts/nasadit-swap.mjs <rpc> <soubor s frází> [nonce factory]
// Fráze se nikam nevypisuje. Nejdřív spusťte nasadit-tokeny.mjs.
// Adresa kontraktu závisí jen na nonce. Na testnetu byla factory na nonce 15 a router na 16 (0xfee4…1E95, natvrdo v aplikacích
// jako Wpayin): s argumentem 15 skript doplní chybějící nonce prázdnými převody sama sobě a adresy zůstanou stejné.
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
