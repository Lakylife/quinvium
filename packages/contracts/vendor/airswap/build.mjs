#!/usr/bin/env node
// Compiles AirSwap SwapERC20 v4.3 (npm @airswap/swap-erc20 4.3.1, MIT) outside build.js.
// build.js is not used here: it rewrites predeploys.json and upgrades.json from the genesis and could change consensus.
// The sources are unchanged from the package build-info (contracts/) and from solady 0.0.173 (solady/), licences in LICENSE-*.
// Usage: node packages/contracts/vendor/airswap/build.mjs <folder of the solc 0.8.23 package>
//   (for example npm install --ignore-scripts solc@0.8.23 in a temporary folder)
// The settings are the same as AirSwap: solc 0.8.23, optimizer 999999 runs, evmVersion paris.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const solcDir = process.argv[2];
if (!solcDir) throw new Error('Usage: build.mjs <folder of the solc 0.8.23 package>');
const solc = createRequire(join(solcDir, 'package.json'))(solcDir);
if (!solc.version().startsWith('0.8.23+commit.f704f362')) throw new Error(`solc 0.8.23 is needed, not ${solc.version()}`);

const here = dirname(fileURLToPath(import.meta.url));
const sources = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.sol')) sources[relative(here, p)] = { content: readFileSync(p, 'utf8') };
  }
};
walk(join(here, 'contracts'));
walk(join(here, 'solady'));

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 999999 },
    evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'evm.methodIdentifiers', 'metadata'] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
const c = out.contracts['contracts/SwapERC20.sol'].SwapERC20;
const artifact = {
  contractName: 'SwapERC20',
  source: '@airswap/swap-erc20 4.3.1 (MIT)',
  compiler: solc.version(),
  settings: input.settings.optimizer && { optimizer: input.settings.optimizer, evmVersion: input.settings.evmVersion },
  abi: c.abi,
  bytecode: `0x${c.evm.bytecode.object}`,
  deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
  methodIdentifiers: c.evm.methodIdentifiers,
};
writeFileSync(join(here, 'SwapERC20.json'), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`SwapERC20.json: ${artifact.bytecode.length / 2 - 1} B, ${solc.version()}`);
