// Asking a pool for work is free, so devices created in bulk must not push out the devices and jobs of real miners.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { PoolServer } from '../src/mining/pool.js';
import { StratumServer } from '../src/mining/stratum.js';

const pool = () => new PoolServer({ chain: {}, work: {}, mempool: {}, address: new Uint8Array(20), key: new Uint8Array(32).fill(7) });
const addr = (i) => Uint8Array.from(Buffer.from(i.toString(16).padStart(40, '0'), 'hex'));

test('a flood of new devices and jobs does not evict a miner that delivers shares', () => {
  const p = pool();
  const honest = p._session(addr(1), 'rig');
  p._addJob('0xhonest-old', { session: honest });
  // The first share proves the device; its current job moves among the protected ones.
  honest.proven = true;
  p.fresh.delete(honest.id);
  p.freshJobs.delete('0xhonest-old');
  p._addJob('0xhonest-old', { session: honest });
  for (let i = 0; i < 40_000; i++) {
    const s = p._session(addr(1000 + i), 'x');
    p._addJob(`0xjunk${i}`, { session: s });
  }
  assert.ok(p.sessions.has(honest.id), 'the real miner keeps its device');
  assert.ok(p.jobs.has('0xhonest-old'), 'and its job');
  assert.ok(p.sessions.size <= 16_384 && p.fresh.size <= 4096 && p.freshJobs.size <= 4096);
  assert.equal(p.jobs.size, p.freshJobs.size + p.provenJobs.size);
});

test('jobs older than the share age limit are dropped, so templates do not pile up in memory', () => {
  const chain = { head: { number: 100n } };
  const p = new PoolServer({ chain, work: {}, mempool: {}, address: new Uint8Array(20), key: new Uint8Array(32).fill(7) });
  const s = p._session(addr(1), 'rig');
  s.proven = true;
  const job = (n) => ({ session: s, block: { header: { number: n } } });
  for (let i = 0; i < 500; i++) {
    chain.head.number = 100n + BigInt(i);
    p._addJob(`0xjob${i}`, job(chain.head.number));
  }
  // Only jobs whose share could still reach the contract stay (32 blocks minus the 4-block margin).
  assert.ok(p.jobs.size <= 28, `kept ${p.jobs.size} jobs`);
  assert.ok(p.jobs.has('0xjob499'), 'the current job stays');
  assert.ok(!p.jobs.has('0xjob0'), 'an old job is gone');
  assert.equal(p.jobs.size, p.freshJobs.size + p.provenJobs.size);
});

test('Stratum: a connection that keeps logging in or asking for work is closed', async () => {
  const work = Object.assign(new (await import('node:events')).EventEmitter(), { getWork: async () => { throw new Error('no work'); } });
  const server = new StratumServer({ chain: {}, work, port: 0 });
  await server.start();
  try {
    for (const lines of [
      Array.from({ length: 6 }, (_, i) => ({ id: i, method: 'eth_submitLogin', params: [`0x${'11'.repeat(20)}.r${i}`] })),
      [{ id: 0, method: 'eth_submitLogin', params: [`0x${'11'.repeat(20)}`] }, ...Array.from({ length: 10 }, (_, i) => ({ id: i + 1, method: 'eth_getWork', params: [] }))],
    ]) {
      const socket = net.connect(server.port, '127.0.0.1');
      await once(socket, 'connect');
      socket.on('data', () => {});
      socket.write(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
      await Promise.race([once(socket, 'close'), new Promise((_, no) => setTimeout(() => no(new Error('not closed')), 3000))]);
    }
  } finally {
    await server.stop();
  }
});
