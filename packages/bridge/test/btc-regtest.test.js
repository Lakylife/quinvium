// Most proti skutečnému Bitcoin Core v izolované síti regtest. Bez programu bitcoind se test přeskočí.
// Spuštění: BITCOIND=/cesta/k/bitcoind node --test packages/bridge/test/btc-regtest.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ethers } from 'ethers';
import { Relayer } from '../src/relayer.js';
import { BITCOIN, BitcoinBridge, bitcoinRpc } from '../src/btc-bridge.js';
import { publicKey } from '../src/bitcoin.js';
import { artifacts, makeChain } from './helpers/chains.js';

const { BITCOIND } = process.env;
const RPC_PORT = 18998;
const LOGIN = { user: 'aether', password: 'test' };

test('skutečný Bitcoin Core: vklad, výběr a platné podpisy podle sítě', { skip: BITCOIND ? false : 'nastavte BITCOIND=/cesta/k/bitcoind' }, async () => {
  const proc = spawn(BITCOIND, ['-regtest', `-datadir=${mkdtempSync(join(tmpdir(), 'aether-regtest-'))}`, `-rpcport=${RPC_PORT}`, '-port=18999', '-listen=0', `-rpcuser=${LOGIN.user}`, `-rpcpassword=${LOGIN.password}`, '-fallbackfee=0.0002'], { stdio: 'ignore' });
  const people = Array.from({ length: 3 }, () => ethers.Wallet.createRandom());
  const [admin, guardian, alice] = people;
  const validators = Array.from({ length: 3 }, () => ({ wallet: ethers.Wallet.createRandom(), btcKey: `0x${crypto.randomBytes(32).toString('hex')}` }));
  const A = makeChain(52403n, 'aether', [...people, ...validators.map((v) => v.wallet)]);
  try {
    const url = `http://127.0.0.1:${RPC_PORT}`;
    const rpc = bitcoinRpc(url, LOGIN);
    for (let i = 0; i < 100; i++) {
      if (await rpc('getblockcount').catch(() => null) !== null) break;
      await new Promise((r) => { setTimeout(r, 200); });
    }
    await rpc('createwallet', ['test']);
    const wallet = bitcoinRpc(`${url}/wallet/test`, LOGIN);
    const mineTo = await wallet('getnewaddress');
    await rpc('generatetoaddress', [110, mineTo]);

    await A.start();
    const iface = new ethers.Interface(artifacts.BridgeGateway.abi);
    const gate = await A.deploy('BridgeGateway', admin, admin.address, guardian.address, validators.map((v) => v.wallet.address), 2);
    const r = await A.ok(gate.createWrapped('Bridged Bitcoin', 'aBTC', 8, Number(BITCOIN), ethers.ZeroHash, 100_000_000_000n, 50_000_000_000n));
    const aBtc = A.at('WrappedAsset', iface.parseLog(r.logs.find((l) => l.topics[0] === iface.getEvent('WrappedCreated').topicHash)).args.token);
    await A.ok(gate.setOutbound(aBtc.target, Number(BITCOIN), true, true, 50_000n));
    const chains = [{ id: A.id, name: 'Quinvium', provider: A.provider, gateway: gate.target, confirmations: 1, startBlock: 0 }];
    const team = validators.map((v) => {
      const relayer = new Relayer({ chains, privateKey: v.wallet.privateKey });
      const bridge = new BitcoinBridge({
        rpc, network: 'regtest', relayer, chainId: A.id, token: aBtc.target, btcKey: v.btcKey, threshold: 2, confirmations: 3,
        validators: validators.map((x) => ({ address: x.wallet.address, btcKey: publicKey(x.btcKey).toString('hex') })),
      });
      return { relayer, bridge };
    });
    const run = async (rounds = 6) => {
      for (let i = 0; i < rounds; i++) {
        for (const m of team) {
          await m.bridge.tick();
          await m.relayer.tick();
        }
        await A.mine();
      }
    };
    await run(1);

    await A.ok(gate.requestBitcoinDeposit(alice.address));
    await run(2);
    await wallet('sendtoaddress', [team[0].bridge.depositAddress(alice.address), 0.5]);
    await rpc('generatetoaddress', [3, mineTo]);
    await run();
    assert.equal(await aBtc.balanceOf(alice.address), 50_000_000n, 'vklad ze skutečné transakce');

    const payee = await wallet('getnewaddress');
    await A.ok(gate.connect(A.connect(alice)).send(aBtc.target, 20_000_000n, BITCOIN, ethers.toUtf8Bytes(payee)));
    await run();
    await rpc('generatetoaddress', [3, mineTo]);
    await run(2);
    const paid = await wallet('getreceivedbyaddress', [payee, 1]);
    assert.ok(paid > 0.199 && paid < 0.2, `síť přijala platbu, příjemce má ${paid} BTC`);
    assert.ok(Object.values(team[0].bridge.state.data.withdrawals).every((w) => w.status === 'paid'));
    await A.stop();
  } finally {
    proc.kill('SIGTERM');
  }
});
