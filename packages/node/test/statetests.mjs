// Oficiální testy EVM z repozitáře ethereum/tests (GeneralStateTests) nad skutečným kódem uzlu:
// stejný stavový strom, cache, kryptografie i obcházení chyb knihovny jako při ověřování bloků.
//
//   node test/statetests.mjs <složka s testy> [Shanghai|Cancun|Osaka] [filtr]
//
// Shanghai se pouští s čistým ceníkem Shanghai. Cancun s pravidly Quinvia bez cen z Fusaky, protože
// sada Cancun očekává původní cenu MODEXP. Osaka přidává EIP-7823 a EIP-7883 a slouží pro testy MODEXP
// z ethereum/execution-spec-tests. Sada Osaka očekává i EIP-7623, který Quinvium nemá, proto pro ni
// AETHER_EXTRA_EIPS=7623. Rozdíly oproti Ethereu popisuje docs/SPECIFIKACE.md.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createBlock } from '@ethereumjs/block';
import { createAccessList2930Tx, createFeeMarket1559Tx, createLegacyTx } from '@ethereumjs/tx';
import { MerklePatriciaTrie } from '@ethereumjs/mpt';
import { MerkleStateManager } from '@ethereumjs/statemanager';
import { Account, Address, ValueEncoding, createAddressFromString, hexToBytes, bytesToHex, unpadBytes } from '@ethereumjs/util';
import { runTx } from '@ethereumjs/vm';
import { RLP } from '@ethereumjs/rlp';
import { keccak } from '../src/util/bytes.js';
import { Overlay, makeCommon, newVm, openState } from '../src/core/executor.js';

const [dir, fork = 'Shanghai', filter] = process.argv.slice(2);
if (!dir) {
  console.error('Použití: node test/statetests.mjs <GeneralStateTests> [Shanghai|Cancun] [filtr]');
  process.exit(2);
}

/** Produkční konfigurace EVM, jen s čistým ceníkem Etherea. */
const commonFor = (name) => makeCommon({ name: 'statetest', chainId: 1n }, {
  eips: [...({ Cancun: [1153, 5656, 6780], Osaka: [1153, 5656, 6780, 7823, 7883] }[name] ?? []), ...(process.env.AETHER_EXTRA_EIPS?.split(',').map(Number) ?? [])],
  blake2RoundGas: 1,
});

// Quinvium nemá bloby, Cancun je ale v testech počítá: adresa 0x0a je předkompilovaný kontrakt a stojí méně gasu,
// 0x49 a 0x4a jsou platné instrukce. Bez bloby v transakci se chovají předvídatelně, proto je tady
// nahrazují náhradní verze. Zbylé rozdíly tak nemůžou být způsobené blobami a jde o skutečné chyby.
const BLOB_STUBS = {
  customPrecompiles: [{
    address: new Address(hexToBytes('0x000000000000000000000000000000000000000a')),
    function: (opts) => ({ executionGasUsed: opts.gasLimit, exceptionError: { error: 'kzg', errorType: 'EVMError' }, returnValue: new Uint8Array(0) }),
  }],
  customOpcodes: [
    { opcode: 0x49, opcodeName: 'BLOBHASH', baseFee: 3, logicFunction: (s) => { s.stack.pop(); s.stack.push(0n); } },
    { opcode: 0x4a, opcodeName: 'BLOBBASEFEE', baseFee: 2, logicFunction: (s) => { s.stack.push(1n); } },
  ],
};

/** Čistá knihovna bez cache a bez našich úprav, pro porovnání při hledání příčiny rozdílu. */
function plainState(store, common) {
  const trie = new MerklePatriciaTrie({ db: new Overlay(store), useKeyHashing: true, valueEncoding: ValueEncoding.Bytes, common, cacheSize: 0 });
  return { stateManager: new MerkleStateManager({ common, trie, prefixCodeHashes: true }) };
}

class MemoryStore {
  constructor() { this.map = new Map(); }
  kvGet(k) { return this.map.get(k.toString('hex')); }
  kvPutMany(entries) { for (const [k, v] of entries) this.map.set(k, v); }
}

// Testy počítají BLOCKHASH jako keccak čísla bloku zapsaného desítkově.
const blockchain = {
  getBlock: async (n) => ({ hash: () => keccak(new TextEncoder().encode(BigInt(n).toString())) }),
  shallowCopy() { return this; },
};

const big = (h) => (h === undefined || h === '0x' ? 0n : BigInt(h));
const bytes = (h) => hexToBytes(h.startsWith('0x') ? h : `0x${h}`);

function makeTx(t, idx, common) {
  const data = t.data[idx.data];
  const gasLimit = big(t.gasLimit[idx.gas]);
  const value = big(t.value[idx.value]);
  const to = t.to && t.to !== '0x' ? createAddressFromString(t.to) : undefined;
  const accessList = t.accessLists?.[idx.data];
  const base = { nonce: big(t.nonce), gasLimit, value, data: bytes(data), to };
  const opts = { common };
  const key = bytes(t.secretKey);
  if (t.maxFeePerGas !== undefined) {
    return createFeeMarket1559Tx({ ...base, chainId: 1n, maxFeePerGas: big(t.maxFeePerGas), maxPriorityFeePerGas: big(t.maxPriorityFeePerGas), accessList: accessList ?? [] }, opts).sign(key);
  }
  if (accessList !== undefined && accessList !== null) {
    return createAccessList2930Tx({ ...base, chainId: 1n, gasPrice: big(t.gasPrice), accessList }, opts).sign(key);
  }
  return createLegacyTx({ ...base, gasPrice: big(t.gasPrice) }, opts).sign(key);
}

async function runCase(test, post, common, logsSeen) {
  const store = new MemoryStore();
  const { stateManager } = process.env.AETHER_PLAIN ? plainState(store, common) : await openState(store, common, null);

  for (const [addr, a] of Object.entries(test.pre)) {
    const address = createAddressFromString(addr);
    await stateManager.putAccount(address, new Account(big(a.nonce), big(a.balance)));
    if (a.code && a.code !== '0x') await stateManager.putCode(address, bytes(a.code));
    for (const [slot, value] of Object.entries(a.storage ?? {})) {
      await stateManager.putStorage(address, bytes(`0x${big(slot).toString(16).padStart(64, '0')}`), unpadBytes(bytes(`0x${big(value).toString(16).padStart(64, '0')}`)));
    }
  }
  await stateManager.flush();

  const vm = await newVm(common, stateManager, blockchain, fork === 'Shanghai' ? {} : BLOB_STUBS);
  const e = test.env;
  const block = createBlock({
    header: {
      number: big(e.currentNumber), coinbase: createAddressFromString(e.currentCoinbase), timestamp: big(e.currentTimestamp),
      gasLimit: big(e.currentGasLimit), baseFeePerGas: big(e.currentBaseFee ?? '0x7'), difficulty: 0n,
      mixHash: e.currentRandom ? bytes(`0x${big(e.currentRandom).toString(16).padStart(64, '0')}`) : new Uint8Array(32), nonce: new Uint8Array(8),
    },
  }, { common, setHardfork: false, skipConsensusFormatValidation: true });

  // Stejně jako v referenčních nástrojích: coinbase se dotkne vždy a prázdné účty nakonec zmizí.
  const coinbase = createAddressFromString(e.currentCoinbase);
  await vm.evm.journal.putAccount(coinbase, (await stateManager.getAccount(coinbase)) ?? new Account());

  let logs = [];
  try {
    const tx = makeTx(test.transaction, post.indexes, common);
    const r = await runTx(vm, { tx, block, skipHardForkValidation: true });
    logs = r.execResult.logs ?? [];
  } catch (err) {
    if (!post.expectException) logsSeen.note = err.message;
  }

  await vm.evm.journal.cleanup();
  await stateManager.flush();
  const root = bytesToHex(await stateManager.getStateRoot());
  const logHash = bytesToHex(keccak(RLP.encode(logs)));
  return { root, logHash };
}

function collect(path, out) {
  for (const name of readdirSync(path)) {
    const p = join(path, name);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

const SKIP = /stEIP4844|blob|BLOB/i;  // bloby síť záměrně nemá
const files = collect(dir, []).filter((f) => !SKIP.test(f) && (!filter || f.includes(filter)));
const common = commonFor(fork);
const started = Date.now();
let pass = 0;
let fail = 0;
let skipped = 0;
let reported = 0;
const failures = [];

for (const file of files) {
  let suite;
  try {
    suite = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    continue;
  }
  for (const [name, test] of Object.entries(suite)) {
    const posts = test.post?.[fork];
    if (!posts) { skipped += 1; continue; }
    if (SKIP.test(JSON.stringify(test.transaction).slice(0, 2000)) || test.transaction?.blobVersionedHashes) { skipped += 1; continue; }
    for (const post of posts) {
      const seen = {};
      try {
        const { root, logHash } = await runCase(test, post, common, seen);
        if (root === post.hash && (post.logs === undefined || logHash === post.logs)) pass += 1;
        else {
          fail += 1;
          failures.push(`${name} [d${post.indexes.data} g${post.indexes.gas} v${post.indexes.value}] kořen ${root.slice(0, 12)} čekáno ${post.hash.slice(0, 12)} ${seen.note ?? ''}`);
        }
      } catch (e) {
        fail += 1;
        failures.push(`${name}: výjimka ${e.message}`);
      }
    }
  }
  if (pass + fail - reported >= 1000) {
    reported = pass + fail;
    console.error(`${reported} případů, ${fail} selhalo, ${((Date.now() - started) / 1000) | 0} s`);
  }
}

console.log(`\n${fork}: prošlo ${pass}, selhalo ${fail}, přeskočeno sad ${skipped}, čas ${((Date.now() - started) / 1000) | 0} s`);
for (const f of failures) console.log(`  ${f}`);
process.exit(fail ? 1 : 0);
