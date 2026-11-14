// Read load: how many queries one node handles and how latency grows with concurrent clients.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { call, measure, root, row, startNode } from './spolecne.mjs';

const { ethers } = createRequire(`${root}/package.json`)('ethers');
const artifacts = JSON.parse(readFileSync(`${root}/packages/contracts/dist/artifacts.json`));
const LIST = new ethers.Interface(artifacts.PoolFactory.abi).encodeFunctionData('list', [0, 10]);
const FACTORY = artifacts.PoolFactory.address;

const ADDRESS = '0x2546BcD3c84621e976D8185a91A922aE77ECEc30';
const node = await startNode({ rpc: '8901', p2p: '30901', stratum: '3901', extra: ['--dev-mine', '--miner-address', ADDRESS] });
try {
  while (BigInt(await call(node.url, 'eth_blockNumber')) < 5n) await new Promise((r) => { setTimeout(r, 200); });
  const cases = [
    ['eth_blockNumber', () => call(node.url, 'eth_blockNumber')],
    ['eth_getBalance', () => call(node.url, 'eth_getBalance', [ADDRESS, 'latest'])],
    ['eth_getBlockByNumber', () => call(node.url, 'eth_getBlockByNumber', ['latest', true])],
    ['eth_call (kontrakt)', () => call(node.url, 'eth_call', [{ to: FACTORY, data: LIST }, 'latest'])],
    ['eth_getLogs (1000 bloků)', () => call(node.url, 'eth_getLogs', [{ fromBlock: '0x0', toBlock: 'latest' }])],
    ['aether_stats', () => call(node.url, 'aether_stats')],
    ['aether_blocks', () => call(node.url, 'aether_blocks', [{ limit: 25 }])],
    ['aether_addressInfo', () => call(node.url, 'aether_addressInfo', [ADDRESS])],
  ];
  for (const concurrency of [1, 32, 256]) {
    console.log(`\n== souběžných klientů: ${concurrency}`);
    for (const [name, fn] of cases) row(name, await measure(fn, concurrency, 3000));
  }
  const mem = await import('node:child_process').then(({ execSync }) => execSync(`ps -o rss= -p ${node.proc.pid}`).toString().trim());
  console.log(`\nPaměť uzlu: ${Math.round(Number(mem) / 1024)} MB`);
} finally {
  node.proc.kill('SIGTERM');
}
process.exit(0);
