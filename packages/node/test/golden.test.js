// Fixed consensus fingerprints. When this test fails, the network rules or a dependency have changed:
// on a running network this would be a hard fork. Values may change only deliberately and before the network launches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createFeeMarket1559Tx } from '@ethereumjs/tx';
import { Address } from '@ethereumjs/util';
import { Chain } from '../src/core/chain.js';
import { Block, Header } from '../src/core/types.js';
import { forkId } from '../src/core/forks.js';
import { loadAlloc } from '../src/node.js';
import { CONSENSUS, GENESIS_RULES, GWEI, NETWORKS, WEI } from '../src/params.js';
import { toHex } from '../src/util/bytes.js';
import { bytesToBigInt, targetForDifficulty } from '../src/crypto/ethash.js';
import { POW_DIR } from './helpers/chain.js';

const GENESIS = {
  mainnet: '0x49c889ad9d4f44869cf7f97a6e079a50dbf13974263b1afedec3b774ebeeac39',   // launch 14 Nov 2026 00:00 CET, difficulty 2^27
  testnet: '0x4845f69c270efcf1f74a789a9ad85d31a5128a1907a7fdf5d1dd131eebaed121',   // fourth restart 13 Nov 2026 (testnet-5, name Quinvium in genesis)
  dev: '0x907abad331b88b856057582dcce34f526f18378a8620c197b5c31a1459587390',
};

test('the genesis of all networks is exactly fixed', async () => {
  for (const [name, expected] of Object.entries(GENESIS)) {
    const c = await Chain.open({ network: NETWORKS[name], dataDir: ':memory:', powDir: POW_DIR, alloc: loadAlloc() });
    assert.equal(toHex(c.genesis.hash()), expected, name);
    assert.equal(forkId(NETWORKS[name], c.genesis.hash(), 0n).next, NETWORKS[name].forks[0].block);
  }
});

test('consensus parameters match the specification', () => {
  const printable = JSON.stringify({ ...CONSENSUS, ...GENESIS_RULES }, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  assert.equal(createHash('sha256').update(printable).digest('hex'), 'fb3ce4e79a29eb9427b7d0c7c32c33f9c8abd83a3427bc657b0934802d7f7db1');
});

test('the system contracts are exactly fixed', () => {
  const code = readFileSync(new URL('../src/genesis/predeploys.json', import.meta.url));
  assert.equal(createHash('sha256').update(code).digest('hex'), '9519cbc69556b591bcbb01c2308a1a822e51b26bdd049a81d12a472c85351472');
});

// The fingerprints changed on 4 Nov 2026 with the second testnet restart: the genesis text and the name of the wrapped coin (WQU).
// The first variant guards the rules before the fork: the old rules must not change by a single bit.
const CHAINS = [
  ['bez forku', [], '0xe65a1bfcef2cb1dc9a5a89de26ae539258ecf62cd51883c6b96dae3ebce08248', '0xfca5ea9aedc9ae10a1e469c495f5f63f6e9c415b808b582165e441db31a23b14'],
  ['s forkem poolů', NETWORKS.dev.forks, '0x607ea55b7aa0b024ed4bdff2d1a9efc6c04fced0ff901c9d1c33d4416f3d4cdc', '0x5bdd5146de8783f86aabec50328e0d760dd845a003b1dba291c70d37b3d574a8'],
];

for (const [label, forks, expectedHash, expectedRoot] of CHAINS) test(`a deterministic chain with a transaction, a contract and fees always gives the same hash (${label})`, async () => {
  // The key is fixed and public; it serves only this test.
  const key = new Uint8Array(32).fill(7);
  const { privateToAddress, bytesToHex } = await import('@ethereumjs/util');
  const sender = privateToAddress(key);
  const contract = '0x00000000000000000000000000000000000c0de2';
  const network = { ...NETWORKS.dev, forks };
  let clock = Number(network.genesisTimestamp);
  const alloc = {
    ...loadAlloc(),
    [bytesToHex(sender)]: { balance: 1000n * WEI },
    // Stores PREVRANDAO, the block number and time, adds 1 to slot 3 and emits a log.
    [contract]: { code: '0x446000554360015542600255600354600101600355602060006001a100' },
  };
  const c = await Chain.open({ network, dataDir: ':memory:', powDir: POW_DIR, alloc, now: () => clock });
  const tx = (nonce, to, data) => createFeeMarket1559Tx({
    chainId: network.chainId, nonce, to, value: 5n, gasLimit: 200000n, maxFeePerGas: 3n * GWEI, maxPriorityFeePerGas: GWEI, data,
  }, { common: c.common }).sign(key);
  const seal = async (block) => {
    const h = block.header;
    for (let n = 0n; ; n++) {
      const nonce = new Uint8Array(Buffer.from(n.toString(16).padStart(16, '0'), 'hex'));
      const { mixDigest, result } = await c.pow.compute(h.sealHash(), nonce, h.number);
      if (bytesToBigInt(result) <= targetForDifficulty(h.difficulty)) {
        const f = Object.fromEntries(Object.entries(h).filter(([k]) => !k.startsWith('_')));
        return new Block(new Header({ ...f, mixHash: mixDigest, nonce }), block.txs);
      }
    }
  };
  const target = new Address(Buffer.from(contract.slice(2), 'hex'));
  for (let i = 0n; i < 12n; i++) {
    clock += 7 + Number(i) * 3;
    const txs = i % 3n === 2n ? [] : [tx(i - (i + 1n) / 3n, target, new Uint8Array([Number(i)]))];
    const block = await c.buildTemplate({ miner: new Uint8Array(20).fill(0x42), txs, extra: 'golden' });
    const r = await c.insertBlock(await seal(block));
    assert.equal(r.status, 'added');
  }
  assert.equal(c.head.number, 12n);
  assert.equal(toHex(c.head.hash()), expectedHash);
  assert.equal(toHex(c.head.stateRoot), expectedRoot);
  assert.equal(c.head.difficulty, 1n);
});
