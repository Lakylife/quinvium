// Post texts. Short, factual, in English, no hype. Every text fits into one X post (280 characters).

const EXPLORER = 'https://explorer.quinvium.com';
const n = (v) => Number(v).toLocaleString('en-US');
const qu = (v) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} QU`;

export function hashrate(h) {
  const units = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
  let v = Number(h); let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i += 1; }
  return `${v.toFixed(v >= 100 ? 0 : 2)} ${units[i]}`;
}

export function format(e) {
  const d = e.data;
  switch (e.kind) {
    case 'milestone':
      return `Quinvium mainnet reached block ${n(d.height)}.\n\n${EXPLORER}/block/${d.height}`;
    case 'hashrate':
      return `New Quinvium network hashrate record: ${hashrate(d.hashrate)} (previous ${hashrate(d.previous)}).\n\n${EXPLORER}/charts`;
    case 'halving-soon':
      return `Quinvium halving #${d.number} in about ${d.days} day${d.days === 1 ? '' : 's'}: block ${n(d.block)}, ${n(d.blocksLeft)} blocks to go. The block reward will be cut in half.\n\n${EXPLORER}/block/${d.block}`;
    case 'halving':
      return `Quinvium halving #${d.number} happened at block ${n(d.block)}. The block reward is now ${qu(d.reward)}.\n\n${EXPLORER}/block/${d.block}`;
    case 'summary':
      return `Quinvium, last 24 h:\nBlocks: ${n(d.blocks)}\nMined: ${qu(d.minted)}\nHashrate: ${hashrate(d.hashrate)}\nActive miners: ${n(d.miners)}\nTransactions: ${n(d.txs)}\nHeight: ${n(d.height)} · Supply: ${qu(d.supply)}\n\n${EXPLORER}`;
    case 'release':
      return `Quinvium ${d.tag} is out${d.name && !d.name.includes(d.tag.replace(/^v/, '')) ? `: ${d.name}` : ''}.\n\n${d.url}`;
    case 'stall':
      return `Quinvium mainnet: no new block for ${d.minutes} minutes (last block ${n(d.height)}). Nodes keep running and blocks continue as soon as a miner finds one.\n\n${EXPLORER}/network`;
    case 'resume':
      return `Quinvium mainnet is producing blocks again (block ${n(d.height)}, the pause lasted about ${d.minutes} min).`;
    case 'pool':
      return `New mining pool on Quinvium: ${d.name || d.address}.\n\n${EXPLORER}/address/${d.address}`;
    default:
      throw new Error(`unknown event ${e.kind}`);
  }
}
