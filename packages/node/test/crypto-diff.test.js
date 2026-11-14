// Cross-check: the WebAssembly implementation must behave identically in all cases
// as the reference implementation in JavaScript. A difference would mean a network split.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { NobleBN254 } from '@ethereumjs/evm';
import { ecrecover as referenceRecover } from '@ethereumjs/util';
import { bn254, ecrecover } from '../src/crypto/native.js';

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const FP = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const b32 = (x) => new Uint8Array(Buffer.from(BigInt(x).toString(16).padStart(64, '0'), 'hex'));
const hex = (b) => Buffer.from(b).toString('hex');

const attempt = (fn) => {
  try {
    return { ok: hex(fn()) };
  } catch {
    return { fail: true };
  }
};

test('ecrecover: WebAssembly matches the reference on valid and malicious inputs', () => {
  const edge = [0n, 1n, 2n, N - 1n, N, N + 1n, P - 1n, P, P + 1n, 2n ** 256n - 1n, N / 2n, N / 2n + 1n];
  let checked = 0;
  const check = (hash, v, r, s, chainId) => {
    const a = attempt(() => referenceRecover(hash, v, r, s, chainId));
    const b = attempt(() => ecrecover(hash, v, r, s, chainId));
    assert.deepEqual(b, a, `hash=${hex(hash)} v=${v} r=${hex(r)} s=${hex(s)}`);
    checked += 1;
  };
  for (let i = 0; i < 1500; i++) {
    const key = randomBytes(32);
    const hash = new Uint8Array(randomBytes(32));
    const sig = secp256k1.Signature.fromBytes(secp256k1.sign(hash, key, { prehash: false, format: 'recovered' }), 'recovered');
    const [r, s] = [b32(sig.r), b32(sig.s)];
    check(hash, 27n + BigInt(sig.recovery), r, s);
    check(hash, BigInt(sig.recovery), r, s);
    check(hash, 35n + 2n * 52401n + BigInt(sig.recovery), r, s, 52401n);
    check(hash, 28n - BigInt(sig.recovery), r, s);               // opposite parity
    check(hash, 27n + BigInt(sig.recovery), r, b32(N - sig.s));  // high s
    check(hash, 27n, new Uint8Array(randomBytes(32)), new Uint8Array(randomBytes(32))); // r does not have to lie on the curve
    check(hash, 29n, r, s);                                       // invalid v
  }
  for (const r of edge) {
    for (const s of edge) {
      for (const hash of [new Uint8Array(32), new Uint8Array(32).fill(0xff), b32(N), new Uint8Array(randomBytes(32))]) {
        check(hash, 27n, b32(r), b32(s));
        check(hash, 28n, b32(r), b32(s));
      }
    }
  }
  assert.ok(checked > 10000);
});

test('bn254: WebAssembly matches the reference on valid and malicious inputs', async () => {
  const wasm = await bn254();
  const noble = new NobleBN254();
  const G1 = [1n, 2n];
  const G2 = [
    11559732032986387107991004021392285783925812861821192530917403151452391805634n,
    10857046999023057135944570762232829481370756359578518086990519993285655852781n,
    4082367875863433681332203403145435568316851327593401208105741076214120093531n,
    8495653923123431417604973247489272438418190587263600148770280649306958101930n,
  ];
  const join = (...parts) => Buffer.concat(parts.map((x) => Buffer.from(typeof x === 'bigint' ? b32(x) : x)));
  const same = (name, input) => {
    const a = attempt(() => noble[name](new Uint8Array(input)));
    const b = attempt(() => wasm[name](new Uint8Array(input)));
    const norm = (r) => (r.fail || r.ok === '' ? { fail: true } : r);
    assert.deepEqual(norm(b), norm(a), `${name} ${hex(input)}`);
  };
  const point = () => {
    const k = BigInt(`0x${randomBytes(31).toString('hex')}`);
    return wasm.mul(new Uint8Array(join(...G1, k)));
  };
  const coords = [0n, 1n, 2n, 3n, FP - 1n, FP, FP + 1n, 2n ** 256n - 1n];
  for (let i = 0; i < 400; i++) {
    const [p, q] = [point(), point()];
    same('add', join(p, q));
    same('add', join(p, p));
    same('add', join(p, new Uint8Array(64)));
    same('add', join(randomBytes(64), q));
    same('mul', join(p, randomBytes(32)));
    same('mul', join(p, FR));
    same('mul', join(p, 0n));
    same('mul', join(randomBytes(64), 3n));
  }
  for (const x of coords) {
    for (const y of coords) {
      same('add', join(x, y, ...G1));
      same('mul', join(x, y, 5n));
      same('pairing', join(x, y, ...G2));
    }
  }
  const negG1 = [1n, FP - 2n];
  for (let i = 0; i < 12; i++) {
    const k = BigInt(`0x${randomBytes(31).toString('hex')}`);
    const a = wasm.mul(new Uint8Array(join(...G1, k)));
    const c = wasm.mul(new Uint8Array(join(...negG1, k)));
    same('pairing', join(a, ...G2, c, ...G2));     // a really valid equality
    same('pairing', join(a, ...G2, a, ...G2));     // nerovnost
    same('pairing', join(new Uint8Array(64), ...G2));
    same('pairing', join(a, new Uint8Array(128)));
    same('pairing', join(a, FP, ...G2.slice(1)));  // coordinates outside the field
    same('pairing', join(a, randomBytes(128)));    // a point outside the subgroup and the curve
  }
});
