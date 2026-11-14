#!/usr/bin/env node
// Deploys the verified token list (TokenRegistry). No test tokens are created: tokens are created by their authors.
// Usage: node scripts/nasadit-tokeny.mjs <rpc> <phrase file>
// The phrase is never printed. The list address is written to packages/explorer/public/deployments.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const [rpc, phraseFile] = process.argv.slice(2);
if (!rpc || !phraseFile) throw new Error('Použití: nasadit-tokeny.mjs <rpc> <soubor s frází>');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = JSON.parse(readFileSync(join(root, 'packages/contracts/dist/artifacts.json')));
const output = join(root, 'packages/explorer/public/deployments.json');
const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true, cacheTimeout: -1 });
const words = /(?:\b[a-z]+\b\s+){11,23}\b[a-z]+\b/.exec(readFileSync(phraseFile, 'utf8'));
if (!words) throw new Error('V souboru není fráze peněženky');
const wallet = ethers.Wallet.fromPhrase(words[0].trim().replace(/\s+/g, ' '), provider);
const { chainId } = await provider.getNetwork();

const registry = await new ethers.ContractFactory(artifacts.TokenRegistry.abi, artifacts.TokenRegistry.bytecode, wallet).deploy(wallet.address);
await registry.waitForDeployment();
console.log(`TokenRegistry: ${registry.target}`);
let all = {};
try { all = JSON.parse(readFileSync(output, 'utf8')); } catch { /* první nasazení */ }
all[chainId.toString()] = { ...all[chainId.toString()], registry: registry.target };
writeFileSync(output, `${JSON.stringify(all, null, 2)}\n`);
console.log(`Zapsáno do ${output}`);
