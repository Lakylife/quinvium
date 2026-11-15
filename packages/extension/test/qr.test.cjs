// The receive code carries the Quinvium mark in the middle and must still scan; payment links are read correctly.
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.qrcode = require('../qrcode.js');
globalThis.jsQR = require('../jsqr.js');
const qr = require('../qr-tools.js');

const ADDRESSES = ['0x7ec85f6DFD7bAa9f4D0Ff93713a7297150a23E5a', '0x0000000000000000000000000000000000000001', '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF'];

test('a code with the mark in the middle still scans, whatever the camera makes of the mark', () => {
  for (const a of ADDRESSES) {
    for (const fill of [0, 255]) assert.equal(qr.decode(qr.pixels(a, 6, fill)), a, `${a} fill ${fill}`);
  }
});

test('the SVG has the mark and the dark modules', () => {
  const s = qr.svg(ADDRESSES[0]);
  assert.match(s, /^<svg viewBox="0 0 \d+ \d+"/);
  assert.match(s, /fill="#FFCD02"/);
  assert.ok((s.match(/h1v1h-1z/g) ?? []).length > 300);
});

test('payment links and plain addresses', () => {
  assert.deepEqual(qr.parsePayment(` ${ADDRESSES[0]} `), { to: ADDRESSES[0] });
  assert.deepEqual(qr.parsePayment(`ethereum:${ADDRESSES[0]}@52401?value=1.5e18`), { to: ADDRESSES[0], chainId: 52401, wei: '1500000000000000000' });
  assert.deepEqual(qr.parsePayment(`quinvium:${ADDRESSES[0]}?amount=2.25`), { to: ADDRESSES[0], amount: '2.25' });
  assert.deepEqual(qr.parsePayment(`ethereum:pay-${ADDRESSES[0]}@52402`), { to: ADDRESSES[0], chainId: 52402 });
  assert.equal(qr.parsePayment('hello'), null);
  assert.equal(qr.parsePayment('0x123'), null);
  assert.equal(qr.parsePayment(`bitcoin:${ADDRESSES[0]}`), null);
});
