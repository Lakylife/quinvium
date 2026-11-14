#!/usr/bin/env node
// Deploys P2P settlement: AirSwap SwapERC20 v4.3 (EIP-712 domain "SWAP_ERC20" / "4.3"), as used by P2P in the Wpayin wallet.
// Usage: node scripts/nasadit-p2p.mjs <rpc> <phrase file> [nonce]
// The address depends only on the nonce. On testnet the contract was created at nonce 18 of the sample wallet (0x60FD…ae02): with argument 18
// the script fills missing nonces with empty transfers to itself and the address stays the same (as with nasadit-swap.mjs).
// The phrase is never printed. Testnet and dev only; the script refuses mainnet (52401).
// The bytecode is in packages/contracts/vendor/airswap/SwapERC20.json (compiled by build.mjs there, identical to the official package).
// Fees protocolFee and protocolFeeLight are 0, the fee recipient is the deploying wallet, bonusScale and bonusMax are 0.
// Native QU enters a trade only wrapped as WQU (WAET 0xae…0a, deposit()).
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

// Check: code on chain, EIP-712 domain and fee.
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
