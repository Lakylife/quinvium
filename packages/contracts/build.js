// Compiling contracts and writing the genesis allocation. System contract addresses are fixed.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const solc = require('solc');
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

export const PREDEPLOYS = {
  Notary: '0xae00000000000000000000000000000000000001',
  AetherNames: '0xae00000000000000000000000000000000000002',
  Credentials: '0xae00000000000000000000000000000000000003',
  SupplyChain: '0xae00000000000000000000000000000000000004',
  Escrow: '0xae00000000000000000000000000000000000005',
  Polls: '0xae00000000000000000000000000000000000006',
  TokenFactory: '0xae00000000000000000000000000000000000007',
  CollectionFactory: '0xae00000000000000000000000000000000000008',
  MultisigFactory: '0xae00000000000000000000000000000000000009',
  WAET: '0xae0000000000000000000000000000000000000a',
  Multicall: '0xae0000000000000000000000000000000000000b',
};

// Contracts added by a fork. They do not belong in genesis; a running network would change its first block.
/** Ordinary contracts the Explorer can deploy (with their bytecode) and then uses only when the code matches. */
export const DEPLOYED_BY_USERS = ['Profiles', 'QuinviumAvatars'];

export const UPGRADES = {
  PoolFactory: '0xae0000000000000000000000000000000000000c',
};

const sources = {};
for (const f of readdirSync(join(here, 'src'))) sources[f] = { content: readFileSync(join(here, 'src', f), 'utf8') };

function findImport(path) {
  for (const base of [join(here, 'node_modules'), join(root, 'node_modules')]) {
    try {
      return { contents: readFileSync(join(base, path), 'utf8') };
    } catch { /* we try the next folder */ }
  }
  return { error: `nenalezeno ${path}` };
}

const input = {
  language: 'Solidity', sources,
  settings: {
    evmVersion: 'cancun', optimizer: { enabled: true, runs: 500 }, metadata: { bytecodeHash: 'none' },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
for (const e of out.errors ?? []) console.warn(e.formattedMessage);

const artifacts = {};
const alloc = {};
const upgrades = {};
for (const [file, contracts] of Object.entries(out.contracts)) {
  if (!sources[file]) continue;
  for (const [name, c] of Object.entries(contracts)) {
    artifacts[name] = { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
    // Deployed later by a user from the Explorer: the Explorer checks the code at the configured address against this hash.
    if (DEPLOYED_BY_USERS.includes(name)) artifacts[name].runtimeSha256 = createHash('sha256').update(Buffer.from(c.evm.deployedBytecode.object, 'hex')).digest('hex');
    if (PREDEPLOYS[name]) {
      if (Object.keys(c.evm.deployedBytecode.immutableReferences ?? {}).length) throw new Error(`${name} must not have immutables`);
      const code = c.evm.deployedBytecode.object;
      if (code.length / 2 > 24576) throw new Error(`${name} exceeds the code size limit: ${code.length / 2} B`);
      alloc[PREDEPLOYS[name]] = { code: `0x${code}` };
      artifacts[name].address = PREDEPLOYS[name];
      console.log(`${name.padEnd(20)} ${PREDEPLOYS[name]} ${String(code.length / 2).padStart(6)} B`);
    }
    if (UPGRADES[name]) {
      if (Object.keys(c.evm.deployedBytecode.immutableReferences ?? {}).length) throw new Error(`${name} must not have immutables`);
      const code = c.evm.deployedBytecode.object;
      if (code.length / 2 > 24576) throw new Error(`${name} exceeds the code size limit: ${code.length / 2} B`);
      upgrades[name] = { address: UPGRADES[name], code: `0x${code}` };
      artifacts[name].address = UPGRADES[name];
      console.log(`${name.padEnd(20)} ${UPGRADES[name]} ${String(code.length / 2).padStart(6)} B`);
    }
  }
}

mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist', 'artifacts.json'), JSON.stringify(artifacts, null, 1));
const genesisDir = join(root, 'packages', 'node', 'src', 'genesis');
mkdirSync(genesisDir, { recursive: true });
writeFileSync(join(genesisDir, 'predeploys.json'), JSON.stringify(alloc));
writeFileSync(join(genesisDir, 'upgrades.json'), JSON.stringify(upgrades));

// The Explorer and wallets need only the ABI and addresses.
const pub = {};
for (const [name, c] of Object.entries(artifacts)) {
  if (DEPLOYED_BY_USERS.includes(name)) { pub[name] = { abi: c.abi, bytecode: c.bytecode, runtimeSha256: c.runtimeSha256 }; continue; }
  if (c.address || ['SwapFactory', 'SwapPair', 'SwapRouter', 'AetherToken', 'AetherCollection', 'Multisig', 'AetherPool', 'StableToken', 'WrappedAsset', 'BridgeGateway', 'TokenRegistry'].includes(name)) pub[name] = { address: c.address, abi: c.abi };
}
writeFileSync(join(root, 'packages', 'explorer', 'public', 'contracts.json'), JSON.stringify(pub));
console.log('Hotovo.');
