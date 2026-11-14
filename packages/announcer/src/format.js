// Post texts for Telegram (HTML, bold headline, link preview) and X (plain text, at most 280 characters).
// Exact numbers with thousands separators and units, a few emoji, one link and two hashtags.

const EXPLORER = 'https://explorer.quinvium.com';
const WEBSITE = 'https://quinvium.com';
const TAGS = '#Quinvium #PoW';
const CAP = 64_000_000;

const n = (v) => Math.round(Number(v)).toLocaleString('en-US');
const qu = (v, digits = 2) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: digits })} QU`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;
const bare = (url) => url.replace(/^https:\/\//, '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const date = (unix) => { const d = new Date(unix * 1000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

export function hashrate(h) {
  const units = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
  let v = Number(h); let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i += 1; }
  return `${v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 1, minimumFractionDigits: v >= 100 ? 0 : 1 })} ${units[i]}`;
}

const percent = (v) => `${(v * 100).toLocaleString('en-US', { maximumFractionDigits: v < 0.01 ? 3 : 2 })}%`;

/**
 * One event in a neutral form: an emoji, a headline, body lines and a link. The channels render it their own way.
 * @returns {{emoji: string, title: string, lines: string[], link: string}}
 */
export function compose(e) {
  const d = e.data;
  switch (e.kind) {
    case 'milestone':
      return { emoji: '🧱', title: `Block ${n(d.height)}`, link: `${EXPLORER}/block/${d.height}`, lines: [
        `Quinvium mainnet has reached block ${n(d.height)}.`,
        ...(d.supply != null ? [`Supply: ${qu(d.supply, 0)} of ${n(CAP)} QU`] : []),
        ...(d.hashrate ? [`Hashrate: ${hashrate(d.hashrate)}`] : []),
      ] };
    case 'hashrate':
      return { emoji: '⚡', title: 'New hashrate record', link: `${EXPLORER}/charts`, lines: [
        `The Quinvium network reached ${hashrate(d.hashrate)}, up from ${hashrate(d.previous)} (+${n((d.hashrate / d.previous - 1) * 100)}%).`,
        'More miners, more security.',
      ] };
    case 'halving-soon':
      return { emoji: '⏳', title: `Halving in ${d.days} day${d.days === 1 ? '' : 's'}`, link: `${EXPLORER}/block/${d.block}`, lines: [
        `At block ${n(d.block)} the block reward drops from ${qu(d.reward ?? 4 / 2 ** (d.number - 1))} to ${qu((d.reward ?? 4 / 2 ** (d.number - 1)) / 2)}.`,
        `${n(d.blocksLeft)} blocks to go${d.eta ? `, expected around ${date(d.eta)}` : ''}.`,
      ] };
    case 'halving':
      return { emoji: '✂️', title: `Halving #${d.number} complete`, link: `${EXPLORER}/block/${d.block}`, lines: [
        `At block ${n(d.block)} the Quinvium block reward dropped to ${qu(d.reward)}.`,
        `Next halving at block ${n(d.block + 8_000_000)}.`,
      ] };
    case 'summary':
      return { emoji: '📊', title: `Quinvium daily report · ${date(d.time)}`, link: EXPLORER, lines: [
        `⛏ Blocks: ${n(d.blocks)}${d.avgBlockTime ? ` (avg ${Number(d.avgBlockTime).toFixed(1)} s)` : ''}`,
        `🪙 Mined: ${qu(d.minted, 0)}`,
        `⚡ Hashrate: ${hashrate(d.hashrate)}`,
        `👷 Active miners: ${n(d.miners)}`,
        `🔁 Transactions: ${n(d.txs)}`,
        `📈 Supply: ${qu(d.supply, 0)} (${percent(Number(d.supply) / CAP)} of the 64M cap)`,
      ] };
    case 'release':
      return { emoji: '🚀', title: `Quinvium ${d.tag} released`, link: d.url, lines: [
        `New version of the node, desktop app and wallets${d.name && !d.name.includes(d.tag.replace(/^v/, '')) ? `: ${d.name}` : ''}.`,
        `Download: ${bare(WEBSITE)}/download`,
      ] };
    case 'stall':
      return { emoji: '⚠️', title: `No new block for ${n(d.minutes)} minutes`, link: `${EXPLORER}/network`, lines: [
        `Last block: ${n(d.height)}. Nothing is lost: nodes keep the chain and blocks continue as soon as a miner finds the next one.`,
      ] };
    case 'resume':
      return { emoji: '✅', title: 'Blocks are flowing again', link: `${EXPLORER}/block/${d.height}`, lines: [
        `Block ${n(d.height)} arrived after a pause of about ${n(d.minutes)} minutes.`,
      ] };
    case 'pool':
      return { emoji: '🏊', title: `New mining pool: ${d.name || 'unnamed'}`, link: `${EXPLORER}/pool/${d.address}`, lines: [
        `${d.feeBps != null ? `Fee ${(d.feeBps / 100).toLocaleString('en-US')}%. ` : ''}Rewards are split by a contract on chain; the operator cannot take miners' coins.`,
      ] };
    case 'miner':
      return { emoji: '⛏', title: 'New miner on Quinvium', link: `${EXPLORER}/address/${d.address}`, lines: [
        `${short(d.address)} mined its first block, #${n(d.block)}. Welcome to the network.`,
      ] };
    case 'node':
      return { emoji: '🛰', title: 'New node joined the network', link: `${EXPLORER}/network`, lines: [
        `Node ${String(d.id).slice(0, 8)}…${d.agent ? ` running ${String(d.agent).replace('quintium-node/', 'v')}` : ''}. More nodes, more resilience.`,
      ] };
    case 'hashrate-jump':
      return { emoji: '📈', title: 'Hashrate rising fast', link: `${EXPLORER}/charts`, lines: [
        `The Quinvium network is at ${hashrate(d.hashrate)}, up ${n((d.hashrate / d.base - 1) * 100)}% on its recent average.`,
      ] };
    case 'week':
      return { emoji: '👷', title: `${n(d.miners)} new miner${d.miners === 1 ? '' : 's'} this week`, link: `${EXPLORER}/miners`, lines: [
        `${n(d.miners)} address${d.miners === 1 ? '' : 'es'} mined ${d.miners === 1 ? 'its' : 'their'} first Quinvium block in the last 7 days.`,
      ] };
    case 'majority':
      return { emoji: '⚠️', title: 'One miner has over half of the hashrate', link: `${EXPLORER}/pools`, lines: [
        `${short(d.address)} did ${Math.round(d.share * 100)}% of the work in the last hour (${n(d.blocks)} of ${n(d.of)} blocks).`,
        'A majority miner can rewrite recent blocks. Wait for more confirmations on large payments; more independent miners and pools make the network safer.',
      ] };
    case 'majority-end':
      return { emoji: '✅', title: 'No single miner has a majority now', link: `${EXPLORER}/pools`, lines: [
        `The largest miner did ${Math.round(d.share * 100)}% of the work in the last hour.`,
      ] };
    case 'digest': {
      const count = (k) => d.items.filter((i) => i.kind === k).length;
      const parts = [count('miner') && `⛏ New miners: ${n(count('miner'))}`, count('node') && `🛰 New nodes: ${n(count('node'))}`, count('hashrate-jump') && '📈 Hashrate rising fast'].filter(Boolean);
      return { emoji: '🗞', title: 'Network update', link: `${EXPLORER}/network`, lines: parts };
    }
    default:
      throw new Error(`unknown event ${e.kind}`);
  }
}

/** Telegram: HTML with a bold headline; the link gets a preview card. */
export function telegramMessage(e) {
  const c = compose(e);
  return {
    text: `${c.emoji} <b>${esc(c.title)}</b>\n\n${c.lines.map(esc).join('\n')}\n\n🔗 <a href="${esc(c.link)}">${esc(bare(c.link))}</a>\n\n${TAGS}`,
    link: c.link,
  };
}

/** X: plain text, at most 280 characters (a link counts as 23). Body lines are dropped from the end if needed. */
export function xMessage(e) {
  const c = compose(e);
  const build = (lines) => `${c.emoji} ${c.title}\n\n${lines.join('\n')}\n\n${c.link}\n\n${TAGS}`;
  const weight = (t) => t.replace(/https:\/\/\S+/g, 'x'.repeat(23)).length;
  let lines = [...c.lines];
  while (lines.length > 1 && weight(build(lines)) > 280) lines = lines.slice(0, -1);
  return { text: build(lines) };
}

/** Plain text of either channel, for logs and the dry run. */
export function format(e, channel = 'x') {
  return channel === 'telegram' ? telegramMessage(e).text : xMessage(e).text;
}
