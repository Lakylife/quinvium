#!/usr/bin/env node
// Nasadí P2P vypořádání: AirSwap SwapERC20 v4.3 (EIP-712 doména "SWAP_ERC20" / "4.3"), jak ho používá P2P v peněžence Wpayin.
// Použití: node scripts/nasadit-p2p.mjs <rpc> <soubor s frází> [nonce]
// Adresa závisí jen na nonce. Na testnetu vznikl kontrakt na nonce 18 ukázkové peněženky (0x60FD…ae02): s argumentem 18
// skript doplní chybějící nonce prázdnými převody sama sobě a adresa zůstane stejná (jako u nasadit-swap.mjs).
// Fráze se nikam nevypisuje. Jen testnet a dev, mainnet (52401) skript odmítne.
// Bajtkód je v packages/contracts/vendor/airswap/SwapERC20.json (přeložený build.mjs tamtéž, shodný s oficiálním balíčkem).
// Poplatky protocolFee a protocolFeeLight jsou 0, příjemcem poplatků je nasazující peněženka, bonusScale a bonusMax 0.
// Nativní QU se do obchodu dostane jen obalené jako WQU (WAET 0xae…0a, deposit()).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const [rpc, phraseFile, wantNonce] = process.argv.slice(2);
if (!rpc || !phraseFile || (wantNonce !== undefined && !/^\d+$/.test(wantNonce))) throw new Error('Použití: nasadit-p2p.mjs <rpc> <soubor s frází> [nonce]');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifact = JSON.parse(readFileSync(join(root, 'packages/contracts/vendor/airswap/SwapERC20.json')));
const output = join(root, 'packages/explorer/public/deployments.json');
const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true, cacheTimeout: -1 });
const { chainId } = await provider.getNetwork();
if (chainId === 52401n) throw new Error('Na mainnetu se P2P kontrakt tímto skriptem nenasazuje');
const words = /(?:\b[a-z]+\b\s+){11,23}\b[a-z]+\b/.exec(readFileSync(phraseFile, 'utf8'));
if (!words) throw new Error('V souboru není fráze peněženky');
const wallet = ethers.Wallet.fromPhrase(words[0].trim().replace(/\s+/g, ' '), provider);

if (wantNonce !== undefined) {
  const target = Number(wantNonce);
  let nonce = await provider.getTransactionCount(wallet.address, 'pending');
  if (nonce > target) throw new Error(`Nonce ${nonce} je už za ${target}, adresa by vyšla jinak`);
  for (; nonce < target; nonce += 1) await (await wallet.sendTransaction({ to: wallet.address, value: 0n, nonce })).wait();
}
const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet).deploy(0, 0, wallet.address, 0, 0);
const tx = contract.deploymentTransaction();
await contract.waitForDeployment();
console.log(`SwapERC20: ${contract.target} (transakce ${tx.hash})`);

// Kontrola: kód na řetězci, doména EIP-712 a poplatek.
const code = await provider.getCode(contract.target);
if (code === '0x') throw new Error('Na adrese není kód');
const expected = ethers.TypedDataEncoder.hashDomain({ name: 'SWAP_ERC20', version: '4.3', chainId, verifyingContract: contract.target });
const onChain = await contract.DOMAIN_SEPARATOR();
if (onChain !== expected) throw new Error(`DOMAIN_SEPARATOR ${onChain} nesedí s ${expected}`);
console.log(`DOMAIN_SEPARATOR ${onChain}, protocolFee ${await contract.protocolFee()}, protocolFeeLight ${await contract.protocolFeeLight()}`);

const all = JSON.parse(readFileSync(output, 'utf8'));
all[chainId.toString()] = { ...(all[chainId.toString()] ?? {}), p2p: { swapERC20: contract.target, version: '4.3' } };
writeFileSync(output, `${JSON.stringify(all, null, 2)}\n`);
console.log(`Zapsáno do ${output}`);
