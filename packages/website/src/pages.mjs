// Obsah webu quinvium.com v češtině a angličtině. Každý text je u sebe v obou jazycích: L(česky, anglicky).
// Fakta pocházejí z packages/node/src/params.js, docs/ a CLAUDE.md. Čísla nevymýšlet.

export const SITE = 'https://quinvium.com';
export const EXPLORER = 'https://explorer.quinvium.com';
export const TESTNET_EXPLORER = 'https://testnet.quinvium.com';
export const GENESIS_HASH = '0x49c889ad9d4f44869cf7f97a6e079a50dbf13974263b1afedec3b774ebeeac39';

// Vestavěné kontrakty v genesis (packages/node/src/genesis/predeploys.json, upgrades.json).
export const PREDEPLOYS = [
  ['0xae00000000000000000000000000000000000001', ['Notář', 'Notary'], ['Otisk dokumentu s časem bloku.', 'Proof that a document existed at a block time.'], 'file'],
  ['0xae00000000000000000000000000000000000002', ['Jména .qu', '.qu names'], ['Čitelné jméno místo adresy.', 'A readable name instead of an address.'], 'at'],
  ['0xae00000000000000000000000000000000000003', ['Certifikáty', 'Credentials'], ['Vydání a odvolání osvědčení.', 'Issue and revoke credentials.'], 'badge'],
  ['0xae00000000000000000000000000000000000004', ['Dodavatelský řetězec', 'Supply chain'], ['Historie zásilky krok za krokem.', 'Step-by-step history of a shipment.'], 'truck'],
  ['0xae00000000000000000000000000000000000005', ['Úschova', 'Escrow'], ['Platba uvolněná po splnění podmínky.', 'Payment released when a condition is met.'], 'lock'],
  ['0xae00000000000000000000000000000000000006', ['Hlasování', 'Polls'], ['Ankety a hlasování na řetězci.', 'On-chain polls and votes.'], 'vote'],
  ['0xae00000000000000000000000000000000000007', ['Továrna tokenů', 'Token factory'], ['Vlastní token ERC-20 bez psaní kódu.', 'Your own ERC-20 token without writing code.'], 'coins'],
  ['0xae00000000000000000000000000000000000008', ['Kolekce NFT', 'NFT collections'], ['Vlastní kolekce ERC-721.', 'Your own ERC-721 collection.'], 'image'],
  ['0xae00000000000000000000000000000000000009', ['Multisig', 'Multisig'], ['Peněženka s více podpisy.', 'A wallet that needs several signatures.'], 'users'],
  ['0xae0000000000000000000000000000000000000a', ['Wrapped QU (WQU)', 'Wrapped QU (WQU)'], ['QU jako token ERC-20.', 'QU as an ERC-20 token.'], 'swap'],
  ['0xae0000000000000000000000000000000000000b', ['Multicall', 'Multicall'], ['Více čtení v jednom volání.', 'Several reads in one call.'], 'layers'],
  ['0xae0000000000000000000000000000000000000c', ['Továrna poolů', 'Pool factory'], ['Pooly pro těžaře s výplatou kontraktem.', 'Mining pools that pay out through a contract.'], 'cube'],
];

const ic = {
  pick: '<path d="M4 20l7-7M14 4l6 6-3 1-4-4 1-3zM9 9l6 6"/>',
  code: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>',
  scale: '<path d="M12 3v18M5 7h14M5 7l-3 7h6l-3-7zM19 7l-3 7h6l-3-7z"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M15.5 9.5a6 6 0 1 1-6 6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
  wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM3 7l12-4v4M16 13h2"/>',
  cube: '<path d="M12 2l9 5v10l-9 5-9-5V7l9-5zM3 7l9 5 9-5M12 12v10"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-6"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6zM14 3v6h6M9 15l2 2 4-4"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  badge: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 22l5-3 5 3-1.5-8"/>',
  truck: '<path d="M1 4h14v12H1zM15 9h4l3 3v4h-7M5.5 19.5a2 2 0 1 0 0-.01M18.5 19.5a2 2 0 1 0 0-.01"/>',
  vote: '<path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  swap: '<path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/>',
  layers: '<path d="M12 2l10 5-10 5L2 7l10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowdown: '<path d="M12 4v12M6 11l6 6 6-6M5 21h14"/>',
  ext: '<path d="M7 17L17 7M9 7h8v8"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
};
export const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ic[n]}</svg>`;

/** Stránky webu. Funkce dostane L(cs, en) pro zvolený jazyk a u(slug) pro odkaz ve stejném jazyce. */
export function pages(L, u, dl = null) {
  const card = (i, h, p) => `<article class="card">${icon(i)}<h3>${h}</h3><p>${p}</p></article>`;
  // Tlačítka: primary (plné), secondary (bílé s linkou), link (text se šipkou). Velikosti md a lg.
  const cta = (href, text, cls = 'primary') => {
    const ext = /^https?:/.test(href);
    const v = cls === 'ghost' ? 'secondary' : cls;
    return `<a class="btn ${v}${v === 'link' ? '' : ' lg'}" href="${href}">${text}${icon(ext ? 'ext' : 'arrow')}</a>`;
  };
  const faq = (q, a) => `<details class="qa"><summary>${q}</summary><div>${a}</div></details>`;
  const addButtons = `<div class="row-btns"><button type="button" class="btn primary lg" data-add="main">${L('Přidat mainnet do MetaMasku', 'Add mainnet to MetaMask')}</button><button type="button" class="btn secondary lg" data-add="test">${L('Přidat testnet', 'Add testnet')}</button></div><p class="msg" data-add-msg></p>`;
  const netTable = `<div class="kv">
    <div class="kv-h"><span></span><span>Mainnet</span><span>Testnet</span></div>
    <div><span>Chain ID</span><code>52401</code><code>52402</code></div>
    <div><span>${L('Měna', 'Currency')}</span><code>QU</code><code>tQU</code></div>
    <div><span>RPC (HTTPS)</span><code>https://rpc.quinvium.com</code><code>https://rpc1.quinvium.com</code></div>
    <div><span>WebSocket</span><code>wss://rpc.quinvium.com</code><code>wss://rpc1.quinvium.com</code></div>
    <div><span>Explorer</span><a href="${EXPLORER}">explorer.quinvium.com</a><a href="${TESTNET_EXPLORER}">testnet.quinvium.com</a></div>
    <div><span>P2P seed</span><code>seed.quinvium.com:30524</code><code>seed.quinvium.com:30525</code></div>
  </div>`;

  return [
    // ------------------------------------------------------------------ úvod
    {
      slug: '', nav: false,
      title: L('Quinvium: blockchain, který těží grafické karty', 'Quinvium: the blockchain mined on graphics cards'),
      desc: L('Quinvium (QU) je programovatelná síť s Proof-of-Work a EVM. Bez premine, 4 QU za blok, strop 64 milionů.', 'Quinvium (QU) is a programmable proof-of-work network with the EVM. No premine, 4 QU per block, capped at 64 million.'),
      hero: true,
      body: `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="status-pill"><span class="dot" data-live-dot></span><span data-hero-status data-before="Mainnet launches 14 Nov 2026 at 00:00 CET" data-on="Mainnet live since 14 Nov 2026">Mainnet launches 14 Nov 2026 at 00:00 CET</span></p>
      <h1>${L('Blockchain, který těží grafické karty', 'The blockchain mined on graphics cards')}</h1>
      <p class="lead">${L('Quinvium je otevřená síť s Proof-of-Work a plným EVM. Bez premine, bez předprodeje, s peněženkami, které už znáte.', 'Quinvium is an open proof-of-work network with a full EVM. No premine, no presale, and wallets you already know.')}</p>
      <div class="row-btns">${cta(u('wallets'), L('Začít', 'Get started'))}${cta(EXPLORER, L('Otevřít Explorer', 'Open Explorer'), 'ghost')}</div>
    </div>
    <div class="hero-art" aria-hidden="true">${heroArt()}</div>
  </div>
</section>

<section class="statbar-wrap">
  <div class="wrap">
    <div class="statbar" data-live>
      <div><span>Block height</span><strong data-m="height" class="sk"></strong></div>
      <div><span>Hashrate</span><strong data-m="hashrate" class="sk"></strong></div>
      <div><span>Avg. block time</span><strong data-m="blocktime" class="sk"></strong></div>
      <div><span>Mined supply</span><strong data-m="supply" class="sk"></strong></div>
    </div>
    <p class="live-note" data-live-note data-before="Numbers start moving when mainnet launches on 14 November 2026 at 00:00 CET." data-off="The public node is not answering right now." data-on="Live from rpc.quinvium.com, refreshed every 15 s."></p>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="sec-head"><h2>Why Quinvium</h2><p>A network secured by miners and usable by anyone who knows Ethereum.</p></div>
    <div class="bento">
      <article class="tile t-blue span-6 rows-2">
        <div class="tile-ic">${icon('code')}</div>
        <h3>Full EVM, familiar tools</h3>
        <p>Solidity, ethers.js, Hardhat and MetaMask work unchanged. Point them at the public RPC and deploy.</p>
        <pre class="mini"><code>const provider = new ethers.JsonRpcProvider(
  'https://rpc.quinvium.com', 52401);
await provider.getBlockNumber();</code></pre>
        <div class="row-btns"><button type="button" class="btn primary md" data-add="main">Add to MetaMask${icon('arrow')}</button></div>
        <p class="msg" data-add-msg></p>
      </article>
      <a class="tile t-amber span-6 go" href="${u('mining')}">
        <div class="tile-ic">${icon('pick')}</div>
        <h3>Mined on graphics cards</h3>
        <p>Ethash on an ordinary AMD or NVIDIA card. Blocks are backed by work done, not by the size of a stake.</p>
        <span class="go-arrow" aria-hidden="true">${icon('arrow')}</span>
      </a>
      <a class="tile t-amber span-3 go" href="${u('tokenomics')}">
        <div class="tile-ic">${icon('scale')}</div>
        <h3>Fair launch</h3>
        <p>No premine, no presale, no company and no owner.</p>
        <span class="go-arrow" aria-hidden="true">${icon('arrow')}</span>
      </a>
      <article class="tile t-green span-3">
        <div class="tile-ic">${icon('coins')}</div>
        <h3>Fees to miners</h3>
        <p>Fees are not burned. The block miner keeps all of them.</p>
      </article>
    </div>
  </div>
</section>

<section class="sec tint">
  <div class="wrap">
    <div class="sec-head"><h2>Start in a minute</h2><p>The network is open. No account or permission needed.</p></div>
    <ol class="stepper">
      <li><span class="n">1</span><div><h3>Get a wallet</h3><p>The Quinvium app, Wpayin, the Chrome wallet or MetaMask.</p><a class="btn link" href="${u('wallets')}">Choose a wallet${icon('arrow')}</a></div></li>
      <li><span class="n">2</span><div><h3>Add the network</h3><p>One click adds Quinvium mainnet to MetaMask.</p><button type="button" class="btn link" data-add="main">Add to MetaMask${icon('arrow')}</button></div></li>
      <li><span class="n">3</span><div><h3>Mine or explore</h3><p>Switch on mining in the app, or follow the chain in the Explorer.</p><a class="btn link" href="${u('mining')}">How to mine${icon('arrow')}</a></div></li>
    </ol>
    <p class="msg" data-add-msg></p>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="sec-head"><h2>Issuance you can check</h2><p>The rules live in the node code. Difficulty adjusts after every block from the last 60 blocks (LWMA).</p></div>
    <div class="bento">
      <a class="tile t-amber span-8 rows-2 go" href="${u('tokenomics')}">
        <h3>Mined QU over time</h3>
        ${emissionChart(L)}
        <span class="go-arrow" aria-hidden="true">${icon('arrow')}</span>
      </a>
      <div class="tile t-amber span-2 num"><strong>4 QU</strong><span>block reward</span></div>
      <div class="tile t-amber span-2 num"><strong>15 s</strong><span>target block time</span></div>
      <div class="tile t-amber span-2 num"><strong>8M</strong><span>blocks per halving</span></div>
      <div class="tile t-amber span-2 num"><strong>64M</strong><span>QU maximum</span></div>
    </div>
  </div>
</section>

<section class="sec tint">
  <div class="wrap">
    <div class="sec-head row"><div><h2>Latest blocks</h2><p>Straight from mainnet.</p></div><a class="btn link" href="${EXPLORER}">All in the Explorer${icon('ext')}</a></div>
    <div class="blocklist" data-blocks data-txs="tx" data-ago="ago" data-miner="miner" data-explorer="${EXPLORER}"><p class="empty">The first blocks appear after the mainnet launch.</p></div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="sec-head"><h2>Built into the network</h2><p>Twelve contracts are part of the genesis. They have no owner and nobody can switch them off.</p></div>
    <div class="applist">${PREDEPLOYS.map(([a, n, d, i]) => `<div class="appitem"><span class="ai-ic">${icon(i)}</span><span class="ai-txt"><a href="${EXPLORER}/address/${a}"><strong>${n[1]}</strong></a><small>${d[1]}</small></span><button type="button" class="copy" data-copy="${a}" aria-label="Copy address of ${n[1]}" title="${a}"><code>${a.slice(0, 6)}…${a.slice(-4)}</code>${icon('copy')}</button></div>`).join('')}</div>
  </div>
</section>

<section class="sec tint">
  <div class="wrap">
    <div class="sec-head"><h2>Ecosystem</h2><p>The tools that get you onto the network.</p></div>
    <div class="bento">
      <a class="tile t-green span-6 go" href="${u('download')}">
        <div class="tile-ic">${icon('cube')}</div>
        <h3>Quinvium app</h3>
        <p>Wallet, full node, GPU mining and Explorer for macOS and Windows.</p>
        <span class="go-arrow" aria-hidden="true">${icon('arrow')}</span>
      </a>
      <a class="tile t-green span-3 go" href="${u('wallets')}">
        <div class="tile-ic">${icon('wallet')}</div>
        <h3>Wpayin</h3>
        <p>A mobile wallet for iOS and Android.</p>
        <span class="go-arrow" aria-hidden="true">${icon('arrow')}</span>
      </a>
      <a class="tile t-blue span-3 go" href="${EXPLORER}">
        <div class="tile-ic">${icon('globe')}</div>
        <h3>Explorer</h3>
        <p>Blocks, transactions and addresses.</p>
        <span class="go-arrow" aria-hidden="true">${icon('ext')}</span>
      </a>
      <a class="tile t-neutral span-6 go" href="${u('developers')}">
        <div class="tile-ic">${icon('chip')}</div>
        <h3>For builders</h3>
        <p>Public RPC for mainnet and testnet, contract addresses and the JSON-RPC docs.</p>
        <span class="go-arrow" aria-hidden="true">${icon('arrow')}</span>
      </a>
      <a class="tile t-neutral span-6 go" href="${u('ecosystem')}">
        <div class="tile-ic">${icon('swap')}</div>
        <h3>Swap and P2P <span class="tag">testnet only</span></h3>
        <p>Token swaps and direct trades, not deployed on mainnet yet.</p>
        <span class="go-arrow" aria-hidden="true">${icon('arrow')}</span>
      </a>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap narrow-wrap">
    <div class="sec-head"><h2>Common questions</h2></div>
    ${faq('How do I get QU?', 'By mining, or by a transfer from someone who has QU. There is no presale and no exchange.')}
    ${faq('Did anyone get coins before launch?', 'No. The genesis has no balances; every QU is mined, by anyone.')}
    ${faq('Does MetaMask work?', 'Yes, as with any EVM network. Add the network with the button above.')}
    ${faq('Has there been an audit?', 'Internal reviews yes, an independent audit not yet. Quinvium is experimental software.')}
    <p><a class="btn link" href="${u('faq')}">All questions${icon('arrow')}</a></p>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="cta-box">
      <div><h2>Join the network</h2><p>Run a node, start mining or deploy your first contract.</p></div>
      <div class="row-btns">${cta(u('download'), 'Download the app')}</div>
    </div>
  </div>
</section>`,
    },
    // ------------------------------------------------------------------ o síti
    {
      slug: 'about', label: L('O síti', 'About'),
      title: L('O síti Quinvium', 'About Quinvium'),
      desc: L('Co je Quinvium, proč Proof-of-Work a EVM a jak proběhl start sítě.', 'What Quinvium is, why proof-of-work and the EVM, and how the network launched.'),
      lead: L('Programovatelná síť s Proof-of-Work, kterou drží těžaři a používá každý, kdo zná Ethereum.', 'A programmable proof-of-work network secured by miners and usable by anyone who knows Ethereum.'),
      body: `
<section class="sec"><div class="wrap prose">
  <h2>${L('Co je Quinvium', 'What Quinvium is')}</h2>
  <p>${L('Quinvium (zkratka QU) je samostatný blockchain s vlastním uzlem, peněženkami a Explorerem. Bloky vytvářejí těžaři algoritmem Ethash na grafických kartách, transakce a kontrakty zpracovává EVM, stejný stroj jako v Ethereu.', 'Quinvium (ticker QU) is an independent blockchain with its own node, wallets and Explorer. Miners produce blocks with the Ethash algorithm on graphics cards, and transactions and contracts run on the EVM, the same machine as in Ethereum.')}</p>
  <p>${L('Jméno vychází z latinského <em>quinta essentia</em>, pátá esence. Proto má znak tvar pětiúhelníku.', 'The name comes from the Latin <em>quinta essentia</em>, the fifth essence. That is why the logo is a pentagon.')}</p>
  <h2>${L('Proč Proof-of-Work a EVM', 'Why proof-of-work and the EVM')}</h2>
  <div class="cards c2">
    ${card('pick', 'Proof-of-Work', L('O pořadí transakcí rozhoduje vykonaná práce, ne velikost vkladu. Do sítě se zapojí každý s grafickou kartou.', 'The order of transactions is decided by work done, not by the size of a stake. Anyone with a graphics card can take part.'))}
    ${card('code', 'EVM', L('Kontrakty, nástroje a peněženky z Etherea fungují bez úprav. Vývojáři se nic nového učit nemusí.', 'Contracts, tools and wallets from Ethereum work without changes. Developers have nothing new to learn.'))}
  </div>
  <h2>${L('Start sítě', 'Launch')}</h2>
  <div class="kv two">
    <div><span>${L('Genesis', 'Genesis')}</span><span>${L('14. 11. 2026, 00:00 SEČ', '14 November 2026, 00:00 CET')}</span></div>
    <div><span>${L('Otisk genesis', 'Genesis hash')}</span><code>${GENESIS_HASH}</code></div>
    <div><span>Chain ID</span><code>52401</code></div>
    <div><span>Premine</span><span>${L('žádný, zůstatky v genesis jsou nulové', 'none, all genesis balances are zero')}</span></div>
    <div><span>${L('Počáteční obtížnost', 'Initial difficulty')}</span><span>2<sup>27</sup> ${L('(asi 9 MH/s pro blok za 15 s)', '(about 9 MH/s for a 15 s block)')}</span></div>
  </div>
  <h2>${L('Zásady', 'Principles')}</h2>
  <ul class="ticks">
    <li>${L('Žádná firma ani nadace síť neřídí a nikdo ji nevlastní.', 'No company or foundation runs the network and nobody owns it.')}</li>
    <li>${L('Žádný premine, předprodej ani podíl vývojářů.', 'No premine, presale or developer allocation.')}</li>
    <li>${L('Vestavěné kontrakty nemají vlastníka.', 'Built-in contracts have no owner.')}</li>
    <li>${L('Pravidla konsensu se mění jen tvrdým forkem, který musí přijmout uzly.', 'Consensus rules change only by a hard fork that nodes must accept.')}</li>
    <li>${L('Poctivě o rizicích: síť je mladá a nezávislý audit zatím neproběhl.', 'Honest about risks: the network is young and no independent audit has been done yet.')}</li>
  </ul>
</div></section>`,
    },

    // ------------------------------------------------------------------ tokenomika
    {
      slug: 'tokenomics', label: L('Tokenomika', 'Tokenomics'),
      title: L('Tokenomika QU', 'QU tokenomics'),
      desc: L('Odměna 4 QU za blok, půlení po 8 milionech bloků, strop 64 milionů QU, bez premine.', 'A 4 QU block reward, halving every 8 million blocks, capped at 64 million QU, no premine.'),
      lead: L('Všechny QU vznikají těžbou podle pravidel v kódu uzlu.', 'Every QU is created by mining under rules in the node code.'),
      body: `
<section class="sec"><div class="wrap">
  <div class="stats-row">
    <div><strong>4 QU</strong><span>${L('odměna za blok', 'block reward')}</span></div>
    <div><strong>15 s</strong><span>${L('cílová doba bloku', 'target block time')}</span></div>
    <div><strong>8 000 000</strong><span>${L('bloků do půlení', 'blocks per halving')}</span></div>
    <div><strong>64 mil.</strong><span>${L('QU nejvýše', 'QU maximum')}</span></div>
  </div>
  <div class="panel chart-big">${emissionChart(L)}</div>
  <h2>${L('Období odměn', 'Reward eras')}</h2>
  <div class="table">
    <div class="tr th"><span>${L('Období', 'Era')}</span><span>${L('Bloky', 'Blocks')}</span><span>${L('Odměna', 'Reward')}</span><span>${L('Za období', 'Issued')}</span><span>${L('Celkem', 'Total')}</span></div>
    ${[0, 1, 2, 3, 4, 5].map((e) => { const r = 4 / 2 ** e; const issued = 32 / 2 ** e; const total = 64 - 64 / 2 ** (e + 1); const y = (e + 1) * 3.8; return `<div class="tr"><span>${e + 1}${L('. (do ~', ' (to ~')}${y.toFixed(1).replace('.', L(',', '.'))} ${L('roku', 'yrs')})</span><span>${(e * 8).toLocaleString()}–${((e + 1) * 8).toLocaleString()} ${L('mil.', 'M')}</span><span>${String(r).replace('.', L(',', '.'))} QU</span><span>${String(issued).replace('.', L(',', '.'))} ${L('mil.', 'M')}</span><span>${String(total).replace('.', L(',', '.'))} ${L('mil.', 'M')}</span></div>`; }).join('')}
  </div>
  <p class="muted small">${L('Skutečný strop je o zaokrouhlení nižší než 64 milionů. Doba období platí při cílových 15 s na blok.', 'The real cap is slightly below 64 million because of rounding. Era lengths assume the 15 s target block time.')}</p>
  <h2>${L('Poplatky', 'Fees')}</h2>
  <div class="cards c3">
    ${card('coins', L('Celé těžaři', 'All to the miner'), L('Základní poplatek se nepálí. Těžař bloku dostane celý poplatek každé transakce.', 'The base fee is not burned. The block miner receives the full fee of every transaction.'))}
    ${card('bolt', 'EIP-1559', L('Základní poplatek se mění podle zaplnění bloků, nejméně 1 gwei.', 'The base fee follows block usage, with a minimum of 1 gwei.'))}
    ${card('cube', L('Limit gasu', 'Gas limit'), L('10 milionů gasu na blok, těžaři ho mohou hlasováním zvýšit nejvýše na 15 milionů.', '10 million gas per block; miners can vote it up to at most 15 million.'))}
  </div>
  <h2>${L('Co v síti není', 'What the network does not have')}</h2>
  <ul class="ticks no">
    <li>${L('Premine, předprodej, podíl vývojářů ani pokladna.', 'A premine, presale, developer allocation or treasury.')}</li>
    <li>${L('Pálení poplatků nebo jiné snižování nabídky.', 'Fee burning or other supply reduction.')}</li>
    <li>${L('Staking. Bloky vznikají jen těžbou.', 'Staking. Blocks come only from mining.')}</li>
  </ul>
</div></section>`,
    },

    // ------------------------------------------------------------------ těžba
    {
      slug: 'mining', label: L('Těžba', 'Mining'),
      title: L('Těžba Quinvia', 'Mining Quinvium'),
      desc: L('Jak těžit QU na grafické kartě: aplikace Quinvium, vlastní uzel a miner, pooly s výplatou kontraktem.', 'How to mine QU on a graphics card: the Quinvium app, your own node and miner, pools that pay out through a contract.'),
      lead: L('Grafická karta, aplikace a adresa pro výplaty. Víc není potřeba.', 'A graphics card, the app and a payout address. That is all.'),
      body: `
<section class="sec"><div class="wrap">
  <h2>${L('Co potřebujete', 'What you need')}</h2>
  <div class="cards c3">
    ${card('chip', L('Grafická karta', 'A graphics card'), L('AMD nebo NVIDIA s aspoň 2 GB paměti. Data algoritmu (DAG) postupně rostou, takže větší paměť vydrží déle. Ethash smějí těžit i ASICy.', 'AMD or NVIDIA with at least 2 GB of memory. The algorithm data (DAG) grows over time, so more memory lasts longer. Ethash ASICs are allowed too.'))}
    ${card('wallet', L('Adresa pro výplaty', 'A payout address'), L('Jakákoli adresa 0x… z vaší peněženky. Odměny chodí přímo na ni.', 'Any 0x… address from your wallet. Rewards are paid straight to it.'))}
    ${card('globe', L('Připojení', 'A connection'), L('Uzel se k síti připojí sám přes seed.quinvium.com.', 'The node joins the network on its own through seed.quinvium.com.'))}
  </div>

  <h2>${L('Těžba v aplikaci Quinvium', 'Mining in the Quinvium app')}</h2>
  <ol class="numbered">
    <li>${L('Nainstalujte aplikaci pro macOS nebo Windows.', 'Install the app for macOS or Windows.')} <a href="${u('download')}">${L('Ke stažení', 'Download')}</a></li>
    <li>${L('Zvolte síť Mainnet. Aplikace spustí vlastní uzel a stáhne řetězec.', 'Choose the Mainnet network. The app starts its own node and downloads the chain.')}</li>
    <li>${L('V části Těžba zadejte adresu pro výplaty a těžbu zapněte.', 'In Mining, enter your payout address and switch mining on.')}</li>
  </ol>

  <h2>${L('Vlastní uzel a miner', 'Your own node and miner')}</h2>
  <p>${L('Uzel z příkazové řádky a miner <code>quintium-miner</code> pro grafické karty:', 'The command-line node and the <code>quintium-miner</code> GPU miner:')}</p>
  <pre><code>quintium-node --network mainnet --miner-address VAŠE_ADRESA
quintium-miner --address VAŠE_ADRESA --node http://127.0.0.1:8545</code></pre>
  <p>${L('Uzel nabízí i Stratum (port 3333), takže jde použít i jiný miner pro Ethash. Pro přístup z místní sítě spusťte uzel se <code>--stratum-host 0.0.0.0</code>.', 'The node also offers Stratum (port 3333), so other Ethash miners work too. For miners on your local network start the node with <code>--stratum-host 0.0.0.0</code>.')}</p>

  <h2>${L('Sólo, nebo pool', 'Solo or pool')}</h2>
  <div class="cards c2">
    ${card('cube', L('Sólo', 'Solo'), L('Celý blok i poplatky dostanete vy, ale s jednou kartou mezi bloky může uplynout dlouhá doba.', 'You get the whole block and its fees, but with one card there can be a long wait between blocks.'))}
    ${card('users', L('Pool v kontraktu', 'Contract pool'), L('Továrna poolů je přímo v síti. Pool sčítá podíly těžařů a kontrakt vyplácí odměny podle nich. Veřejný pool na mainnetu zatím nikdo neprovozuje.', 'The pool factory is built into the network. A pool counts miner shares and the contract pays rewards by them. Nobody runs a public mainnet pool yet.'))}
  </div>

  <h2>${L('Obtížnost', 'Difficulty')}</h2>
  <p>${L('Obtížnost se upravuje po každém bloku podle posledních 60 bloků (LWMA). Když výkon sítě přibude, bloky se na chvíli zrychlí a obtížnost během minut doroste. Když výkon odejde, srovná se stejně. Nejnižší obtížnost je 2<sup>24</sup>.', 'Difficulty adjusts after every block based on the last 60 blocks (LWMA). When hashrate joins, blocks speed up for a while and difficulty catches up within minutes. When hashrate leaves, it settles the same way. The minimum difficulty is 2<sup>24</sup>.')}</p>

  <h2>${L('Otázky k těžbě', 'Mining questions')}</h2>
  ${faq(L('Kolik vytěžím?', 'How much will I mine?'), L('Podíl vašeho výkonu na výkonu sítě krát 4 QU za každý blok. Za den vznikne asi 5 760 bloků, tedy zhruba 23 040 QU pro celou síť. Aktuální výkon sítě je na úvodní stránce a v Exploreru.', 'Your share of the network hashrate times 4 QU per block. About 5,760 blocks are made a day, roughly 23,040 QU for the whole network. The current hashrate is on the home page and in the Explorer.'))}
  ${faq(L('Jak rychle přijde odměna?', 'How fast does the reward arrive?'), L('Hned s blokem. Odměna je součástí bloku, který vytěžíte.', 'Immediately with the block. The reward is part of the block you mine.'))}
  ${faq(L('Smím těžit na serveru v cloudu?', 'Can I mine on a cloud server?'), L('To závisí na podmínkách poskytovatele. Mnoho z nich těžbu zakazuje.', 'That depends on the provider\'s terms. Many of them forbid mining.'))}
</div></section>`,
    },

    // ------------------------------------------------------------------ peněženky
    {
      slug: 'wallets', label: L('Peněženky', 'Wallets'),
      title: L('Peněženky pro Quinvium', 'Wallets for Quinvium'),
      desc: L('Aplikace Quinvium, Wpayin pro iOS a Android, peněženka pro Chrome a MetaMask.', 'The Quinvium app, Wpayin for iOS and Android, the Chrome wallet and MetaMask.'),
      lead: L('Klíče máte jen vy. Žádná peněženka Quinvia je nikam neposílá.', 'Only you hold the keys. No Quinvium wallet sends them anywhere.'),
      body: `
<section class="sec"><div class="wrap">
  <div class="cards c2 big">
    ${card('cube', L('Aplikace Quinvium', 'Quinvium app'), L('Pro macOS a Windows. Peněženka, plný uzel, těžba, Explorer a Swap v jednom.', 'For macOS and Windows. Wallet, full node, mining, Explorer and Swap in one.'))}
    ${card('wallet', 'Wpayin', L('Mobilní peněženka pro iOS a Android s podporou Quinvia, Swapu a P2P obchodů.', 'A mobile wallet for iOS and Android with Quinvium, Swap and P2P trading.'))}
    ${card('globe', L('Peněženka pro Chrome', 'Chrome wallet'), L('Rozšíření prohlížeče pro aplikace na Quinviu, s vlastním šifrovaným úložištěm.', 'A browser extension for Quinvium apps, with its own encrypted storage.'))}
    ${card('lock', 'MetaMask', L('Funguje jako s každou sítí EVM. Síť přidáte tlačítkem níže.', 'Works as with any EVM network. Add the network with the button below.'))}
  </div>
  <p class="muted small">${L('Aplikaci a peněženku pro Chrome najdete na stránce', 'Get the app and the Chrome wallet on the')} <a href="${u('download')}">${L('Ke stažení', 'Download page')}</a>.</p>

  <h2>${L('Přidat Quinvium do MetaMasku', 'Add Quinvium to MetaMask')}</h2>
  ${addButtons}
  ${netTable}

  <h2>${L('Bezpečnost peněženky', 'Wallet safety')}</h2>
  <ul class="ticks">
    <li>${L('Obnovovací frázi napište na papír a uložte offline. Kdo ji zná, má vaše prostředky.', 'Write the recovery phrase on paper and keep it offline. Whoever knows it owns your funds.')}</li>
    <li>${L('Frázi nikomu nesdělujte. Kdo o ni žádá, je podvodník.', 'Never share the phrase. Anyone who asks for it is a scammer.')}</li>
    <li>${L('Před podpisem zkontrolujte síť (chain ID 52401), adresu a částku.', 'Before signing, check the network (chain ID 52401), the address and the amount.')}</li>
    <li>${L('Tokeny ověřujte podle adresy kontraktu, ne podle jména. Jméno si může zvolit kdokoli.', 'Verify tokens by contract address, not by name. Anyone can pick any name.')}</li>
  </ul>
</div></section>`,
    },

    // ------------------------------------------------------------------ ekosystém
    {
      slug: 'ecosystem', label: L('Ekosystém', 'Ecosystem'),
      title: L('Ekosystém Quinvia', 'The Quinvium ecosystem'),
      desc: L('Vestavěné aplikace sítě, Swap, P2P, pooly a nástroje.', 'Built-in network apps, Swap, P2P, pools and tools.'),
      lead: L('Co v síti běží od prvního bloku a co je zatím jen na testnetu.', 'What runs in the network from block one and what is still testnet-only.'),
      body: `
<section class="sec"><div class="wrap">
  <h2>${L('Vestavěné kontrakty (mainnet i testnet)', 'Built-in contracts (mainnet and testnet)')}</h2>
  <div class="apps">
    ${PREDEPLOYS.map(([a, n, d]) => `<div class="app"><strong>${L(n[0], n[1])}</strong><span>${L(d[0], d[1])}</span><a href="${EXPLORER}/address/${a}"><code>${a.slice(0, 6)}…${a.slice(-4)}</code></a></div>`).join('')}
  </div>

  <h2>${L('Zatím jen na testnetu', 'Testnet only for now')}</h2>
  <div class="cards c3">
    ${card('coins', 'Swap', L('Směnárna s pooly likvidity (factory a router). Na mainnetu zatím nasazená není.', 'An exchange with liquidity pools (factory and router). Not deployed on mainnet yet.'))}
    ${card('users', 'P2P', L('Přímé obchody mezi dvěma stranami přes AirSwap SwapERC20 v4.3, bez poplatků. Na mainnetu zatím není.', 'Direct trades between two parties through AirSwap SwapERC20 v4.3, with no fees. Not on mainnet yet.'))}
    ${card('shield', L('Seznam ověřených tokenů', 'Verified token list'), L('Na mainnetu zatím není. Čeká na správu přes multisig.', 'Not on mainnet yet. It waits for multisig governance.'))}
  </div>
  <p class="muted small">${L('Most do jiných sítí je napsaný, ale nikde nasazený není. Na mainnetu bude jen s nezávislými validátory.', 'A bridge to other networks is written but not deployed anywhere. On mainnet it will run only with independent validators.')}</p>

  <h2>${L('Nástroje', 'Tools')}</h2>
  <div class="cards c3">
    ${card('globe', 'Explorer', L('Bloky, transakce, adresy, tokeny, aplikace sítě a dokumentace.', 'Blocks, transactions, addresses, tokens, network apps and documentation.') + ` <a href="${EXPLORER}">explorer.quinvium.com</a>`)}
    ${card('code', L('Příkazová řádka', 'Command line'), L('Příkaz <code>quinvium</code> umí peněženku, převody i všechny aplikace sítě, česky i anglicky.', 'The <code>quinvium</code> command handles the wallet, transfers and every network app, in Czech and English.'))}
    ${card('cube', L('Plný uzel', 'Full node'), L('Uzel v JavaScriptu s EVM, synchronizací, JSON-RPC, Stratum a serverem poolu.', 'A JavaScript node with the EVM, sync, JSON-RPC, Stratum and a pool server.'))}
  </div>
</div></section>`,
    },

    // ------------------------------------------------------------------ vývojáři
    {
      slug: 'developers', label: L('Vývojáři', 'Developers'),
      title: L('Quinvium pro vývojáře', 'Quinvium for developers'),
      desc: L('Parametry sítě, JSON-RPC, spuštění uzlu a adresy vestavěných kontraktů.', 'Network parameters, JSON-RPC, running a node and built-in contract addresses.'),
      lead: L('Pokud umíte Ethereum, umíte Quinvium.', 'If you know Ethereum, you know Quinvium.'),
      body: `
<section class="sec"><div class="wrap">
  <h2 id="parameters">${L('Parametry sítě', 'Network parameters')}</h2>
  ${netTable}

  <h2>${L('Rychlý start', 'Quick start')}</h2>
  <pre><code>import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://rpc.quinvium.com', 52401);
console.log(await provider.getBlockNumber());</code></pre>
  <p>${L('Hardhat: síť přidejte do <code>hardhat.config.js</code>:', 'Hardhat: add the network to <code>hardhat.config.js</code>:')}</p>
  <pre><code>networks: {
  quinvium: { url: 'https://rpc.quinvium.com', chainId: 52401, accounts: [process.env.KEY] },
  quinviumTestnet: { url: 'https://rpc1.quinvium.com', chainId: 52402, accounts: [process.env.KEY] },
}</code></pre>

  <h2>JSON-RPC</h2>
  <ul class="ticks">
    <li>${L('Běžné metody <code>eth_*</code>, <code>net_*</code> a <code>web3_*</code> včetně odběrů přes WebSocket.', 'Standard <code>eth_*</code>, <code>net_*</code> and <code>web3_*</code> methods, including WebSocket subscriptions.')}</li>
    <li>${L('Navíc <code>quinvium_*</code> pro Explorer: statistiky, adresy, tokeny, těžaři, pooly, vyhledávání.', 'Extra <code>quinvium_*</code> methods for the Explorer: stats, addresses, tokens, miners, pools, search.')}</li>
    <li>${L('Veřejné uzly mají vypnuté těžební metody (<code>eth_getWork</code>, <code>eth_submitWork</code>) a limit požadavků.', 'Public nodes have mining methods (<code>eth_getWork</code>, <code>eth_submitWork</code>) switched off and a request limit.')}</li>
  </ul>
  <p><a class="more" href="${EXPLORER}/docs">${L('Úplná dokumentace RPC a kontraktů →', 'Full RPC and contract documentation →')}</a></p>

  <h2>${L('Vlastní uzel', 'Run a node')}</h2>
  <pre><code>quintium-node --network mainnet</code></pre>
  <div class="kv two">
    <div><span>${L('Porty mainnetu', 'Mainnet ports')}</span><span>P2P 30524 · RPC 8545 · Stratum 3333</span></div>
    <div><span>${L('Porty testnetu', 'Testnet ports')}</span><span>P2P 30525 · RPC 8546 · Stratum 3334</span></div>
    <div><span>${L('Veřejný uzel', 'Public node')}</span><span><code>--no-mining-rpc</code>, ${L('RPC jen za vlastní proxy s HTTPS a', 'RPC only behind your own HTTPS proxy with')} <code>--trust-proxy</code></span></div>
    <div><span>${L('Požadavky', 'Requirements')}</span><span>Node.js 24</span></div>
  </div>

  <h2>${L('Adresy vestavěných kontraktů', 'Built-in contract addresses')}</h2>
  <div class="table mono">
    ${PREDEPLOYS.map(([a, n]) => `<div class="tr"><span>${L(n[0], n[1])}</span><code>${a}</code></div>`).join('')}
    <div class="tr"><span>${L('Ověření práce (precompile)', 'Proof-of-work check (precompile)')}</span><code>0x0000000000000000000000000000000000000100</code></div>
  </div>

  <h2>Testnet</h2>
  <p>${L('Testnet (chain ID 52402, mince tQU bez hodnoty) má stejná pravidla a navíc Swap a P2P. Faucet zatím není: tQU si vytěžte, nebo o ně požádejte.', 'The testnet (chain ID 52402, tQU coins with no value) has the same rules plus Swap and P2P. There is no faucet yet: mine tQU or ask for some.')} <a href="${TESTNET_EXPLORER}">testnet.quinvium.com</a></p>
</div></section>`,
    },

    // ------------------------------------------------------------------ plán
    {
      slug: 'roadmap', label: L('Plán', 'Roadmap'),
      title: L('Plán Quinvia', 'Quinvium roadmap'),
      desc: L('Co je hotové a co je v plánu.', 'What is done and what is planned.'),
      lead: L('Záměry, ne sliby. Termíny uvádíme jen u věcí, které jsou rozhodnuté.', 'Intentions, not promises. Dates only where something is decided.'),
      body: `
<section class="sec"><div class="wrap">
  <ol class="timeline">
    <li class="done"><strong>${L('Hotovo', 'Done')}</strong><span>${L('Uzel, EVM, těžba na kartách, pooly v kontraktu, Explorer v pěti jazycích, aplikace pro macOS a Windows, peněženka pro Chrome, Wpayin, příkazová řádka, veřejný testnet.', 'Node, EVM, GPU mining, contract pools, Explorer in five languages, macOS and Windows app, Chrome wallet, Wpayin, command line, public testnet.')}</span></li>
    <li class="done"><strong>${L('14. 11. 2026', '14 Nov 2026')}</strong><span>${L('Start mainnetu, veřejný uzel rpc.quinvium.com a Explorer.', 'Mainnet launch, public node rpc.quinvium.com and the Explorer.')}</span></li>
    <li><strong>${L('Další kroky', 'Next')}</strong><span>${L('Nezávislý bezpečnostní audit. Druhý veřejný uzel u jiného poskytovatele. Podpisový klíč aktualizací mimo vývojový počítač a znovu zapnuté aktualizace. Podepsané programy pro Windows a peněženka v Chrome Web Store.', 'An independent security audit. A second public node with another provider. An update-signing key off the development machine and remote updates switched back on. Signed Windows builds and the wallet in the Chrome Web Store.')}</span></li>
    <li><strong>${L('Potom', 'Later')}</strong><span>${L('Swap a seznam ověřených tokenů na mainnetu se správou přes multisig. Most s nezávislými validátory. Kompaktní bloky a prořezávání stavu pro velký provoz.', 'Swap and a verified token list on mainnet under multisig governance. A bridge with independent validators. Compact blocks and state pruning for heavy traffic.')}</span></li>
  </ol>
</div></section>`,
    },

    // ------------------------------------------------------------------ bezpečnost
    {
      slug: 'security', label: L('Bezpečnost', 'Security'),
      title: L('Bezpečnost', 'Security'),
      desc: L('Stav bezpečnosti Quinvia, přezkumy kódu a hlášení zranitelností.', 'Quinvium security status, code reviews and vulnerability reports.'),
      lead: L('Poctivě: kód je důkladně testovaný, ale nezávislý audit zatím neproběhl.', 'Honestly: the code is thoroughly tested, but no independent audit has been done yet.'),
      body: `
<section class="sec"><div class="wrap prose">
  <h2>${L('Stav', 'Status')}</h2>
  <ul class="ticks">
    <li>${L('Automatické testy uzlu, kontraktů, peněženek a Exploreru, včetně oficiální sady testů EVM z Etherea.', 'Automated tests of the node, contracts, wallets and Explorer, including the official Ethereum EVM test suite.')}</li>
    <li>${L('Interní přezkumy kódu 7.–8., 10. a 13. 11. 2026, nalezené problémy jsou opravené.', 'Internal code reviews on 7–8, 10 and 13 November 2026, with the findings fixed.')}</li>
  </ul>
  <ul class="ticks no">
    <li>${L('Nezávislý bezpečnostní audit zatím neproběhl.', 'No independent security audit has been done yet.')}</li>
    <li>${L('Aktualizace aplikace na dálku jsou na mainnetu vypnuté, dokud podpisový klíč neleží mimo vývojový počítač.', 'Remote app updates are off on mainnet until the signing key is moved off the development machine.')}</li>
    <li>${L('Síť zatím nese jeden veřejný server a uzly těžařů.', 'The network is carried by one public server and the miners\' nodes so far.')}</li>
  </ul>
  <h2>${L('Nahlášení zranitelnosti', 'Reporting a vulnerability')}</h2>
  <p class="placeholder">${L('Kontakt pro hlášení bude doplněn. Do té doby chybu nezveřejňujte.', 'A reporting contact will be added. Until then please do not disclose issues publicly.')}</p>
  <h2>${L('Rizika', 'Risks')}</h2>
  <p>${L('Quinvium je experimentální software. Malou síť s Proof-of-Work lze krátkodobě přepsat pronajatým výkonem, proto čekejte u větších plateb víc potvrzení. Neukládejte víc, než si můžete dovolit ztratit.', 'Quinvium is experimental software. A small proof-of-work network can be briefly rewritten with rented hashrate, so wait for more confirmations on larger payments. Do not store more than you can afford to lose.')}</p>
</div></section>`,
    },

    // ------------------------------------------------------------------ ke stažení
    {
      slug: 'download', label: L('Ke stažení', 'Download'),
      title: L('Ke stažení', 'Download Quinvium'),
      desc: L('Aplikace Quinvium pro macOS a Windows, uzel, miner a peněženka pro Chrome.', 'The Quinvium app for macOS and Windows, the node, the miner and the Chrome wallet.'),
      lead: dl ? L(`Verze ${dl.version}. Zdarma, bez registrace.`, `Version ${dl.version}. Free, no sign-up.`) : L('Brzy.', 'Coming soon.'),
      body: `
<section class="sec"><div class="wrap">
  <div class="note-box">${icon('shield')}<div><strong>${L('Programy zatím nejsou podepsané', 'Builds are not code-signed yet')}</strong><p>${L('macOS i Windows proto při prvním spuštění zobrazí varování. Před spuštěním si ověřte kontrolní součet níže.', 'macOS and Windows will therefore show a warning on first launch. Verify the checksum below before running anything.')}</p></div></div>
  ${dl ? `<div class="dlgrid">${dl.items.map((f) => `
    <article class="dl">
      <div class="dl-top">${icon(f.icon)}<div><h3>${f.title}</h3><span class="muted small">${f.platform}</span></div></div>
      <p>${f.desc}</p>
      <a class="btn primary md" href="/downloads/${dl.version}/${f.file}" download>${icon('arrowdown')}${L('Stáhnout', 'Download')} <span class="size">${f.size}</span></a>
      <details class="sha"><summary>SHA-256</summary><code>${f.sha256}</code><span class="muted small">${f.file}</span></details>
      ${f.note ? `<p class="small muted">${f.note}</p>` : ''}
    </article>`).join('')}</div>
  <p class="row-btns"><a class="btn link" href="/downloads/${dl.version}/SHA256SUMS.txt">SHA256SUMS.txt${icon('arrow')}</a><a class="btn link" href="https://github.com/Lakylife/quinvium/releases">Also on GitHub Releases${icon('ext')}</a></p>` : ''}

  <h2>Wpayin (iOS, Android)</h2>
  <div class="cards c2">
    ${card('wallet', 'Android', 'Wpayin for Android with Quinvium support. APK builds are published on GitHub. <a href="https://github.com/Lakylife/wpayin-erc20-android-app/releases">github.com/Lakylife/wpayin-erc20-android-app</a>')}
    ${card('wallet', 'iOS', 'There is no public iOS build yet. The source code is on GitHub. <a href="https://github.com/Lakylife/wpayin-erc20-ios-app">github.com/Lakylife/wpayin-erc20-ios-app</a>')}
  </div>

  <h2>First launch</h2>
  <div class="cards c2">
    ${card('lock', 'macOS', 'Unzip and move Quinvium to Applications. On first launch macOS says it cannot verify the developer: open <b>System Settings → Privacy &amp; Security</b> and click <b>Open Anyway</b>, or right-click the app and choose <b>Open</b>. The app is built for Intel; Apple Silicon Macs run it through Rosetta.')}
    ${card('lock', 'Windows', 'Run the installer. If SmartScreen shows "Windows protected your PC", click <b>More info → Run anyway</b>. The portable zip runs without installing.')}
  </div>
  <h2>Chrome wallet</h2>
  <ol class="numbered">
    <li>Unzip the file to a folder you will keep.</li>
    <li>Open <code>chrome://extensions</code> and switch on <b>Developer mode</b>.</li>
    <li>Click <b>Load unpacked</b> and choose the unzipped folder.</li>
  </ol>

  <h2>Verify the checksum</h2>
  <pre><code>shasum -a 256 -c SHA256SUMS.txt --ignore-missing     # macOS, Linux
certutil -hashfile Quinvium-${dl ? dl.version : 'x'}-Windows-x64.exe SHA256    # Windows</code></pre>
  <p class="muted">Download only from quinvium.com. Builds from other sources may be fake. Remote updates are switched off on mainnet, so new versions are installed by hand from this page.</p>
</div></section>`,
    },

    // ------------------------------------------------------------------ otázky
    {
      slug: 'faq', label: L('Otázky', 'FAQ'),
      title: L('Časté otázky', 'Frequently asked questions'),
      desc: L('Odpovědi na časté otázky o Quinviu.', 'Answers to common questions about Quinvium.'),
      lead: L('Krátce a bez příkras.', 'Short and plain.'),
      body: `
<section class="sec"><div class="wrap narrow-wrap">
  ${faq(L('Co je Quinvium?', 'What is Quinvium?'), L('Samostatný blockchain s Proof-of-Work (Ethash) a EVM. Mince se jmenuje QU.', 'An independent blockchain with proof-of-work (Ethash) and the EVM. The coin is QU.'))}
  ${faq(L('Je to fork Etherea?', 'Is it a fork of Ethereum?'), L('Ne. Uzel je vlastní kód v JavaScriptu, který používá EVM z projektu EthereumJS. Historii Etherea nepřebírá.', 'No. The node is its own JavaScript code using the EVM from EthereumJS. It does not carry Ethereum\'s history.'))}
  ${faq(L('Jak získám QU?', 'How do I get QU?'), L('Těžbou, nebo převodem od někoho, kdo QU má. Předprodej ani burzy nejsou.', 'By mining, or by a transfer from someone who has QU. There is no presale and no exchange.'))}
  ${faq(L('Kolik QU kdy vznikne?', 'How many QU will ever exist?'), L('Nejvýše 64 milionů. Odměna 4 QU za blok se půlí každých 8 milionů bloků.', 'At most 64 million. The 4 QU block reward halves every 8 million blocks.'))}
  ${faq(L('Dostal někdo mince předem?', 'Did anyone get coins before launch?'), L('Ne. Genesis nemá žádné zůstatky.', 'No. The genesis has no balances.'))}
  ${faq(L('Je QU investice?', 'Is QU an investment?'), L('Ne. Quinvium nic neslibuje o ceně ani výnosu. Je to experimentální software.', 'No. Quinvium makes no promises about price or returns. It is experimental software.'))}
  ${faq(L('Jakou grafickou kartu potřebuji?', 'Which graphics card do I need?'), L('AMD nebo NVIDIA s aspoň 2 GB paměti. Víc paměti vydrží déle, protože data algoritmu rostou.', 'AMD or NVIDIA with at least 2 GB of memory. More memory lasts longer because the algorithm data grows.'))}
  ${faq(L('Smějí těžit ASICy?', 'Are ASICs allowed?'), L('Ano. Ethash zůstává beze změny.', 'Yes. Ethash is unchanged.'))}
  ${faq(L('Funguje MetaMask?', 'Does MetaMask work?'), L('Ano, jako s každou sítí EVM. Síť přidáte na stránce Peněženky.', 'Yes, as with any EVM network. Add the network on the Wallets page.'))}
  ${faq(L('Jak rychlé jsou bloky?', 'How fast are blocks?'), L('Cíl je 15 sekund. Obtížnost se upravuje po každém bloku.', 'The target is 15 seconds. Difficulty adjusts after every block.'))}
  ${faq(L('Kdy je platba jistá?', 'When is a payment final?'), L('Každý další blok ji zpevní. Hlubší přepis než 256 bloků (asi hodina) uzly odmítnou.', 'Each new block makes it firmer. Nodes refuse a rewrite deeper than 256 blocks (about an hour).'))}
  ${faq(L('Proběhl audit?', 'Has there been an audit?'), L('Interní přezkumy ano, nezávislý audit zatím ne.', 'Internal reviews yes, an independent audit not yet.'))}
  ${faq(L('Co je testnet?', 'What is the testnet?'), L('Zkušební síť s mincí tQU bez hodnoty, pro vývoj a testování.', 'A test network with tQU coins that have no value, for development and testing.'))}
  ${faq(L('Kde je zdrojový kód?', 'Where is the source code?'), 'On GitHub under the MIT license: <a href="https://github.com/Lakylife/quinvium">github.com/Lakylife/quinvium</a>. Anyone can read, run, verify and build on it.')}
</div></section>`,
    },

    // ------------------------------------------------------------------ právní
    {
      slug: 'legal', label: L('Právní upozornění', 'Disclaimer'), footerOnly: true,
      title: L('Právní upozornění', 'Disclaimer'),
      desc: L('Quinvium je experimentální software bez záruky.', 'Quinvium is experimental software without warranty.'),
      lead: L('Přečtěte si před použitím.', 'Please read before use.'),
      body: `
<section class="sec"><div class="wrap prose">
  <ul class="ticks">
    <li>${L('Quinvium je experimentální software poskytovaný tak, jak je, bez jakékoli záruky.', 'Quinvium is experimental software provided as is, without any warranty.')}</li>
    <li>${L('Nic na tomto webu není investiční, finanční, daňové ani právní poradenství.', 'Nothing on this site is investment, financial, tax or legal advice.')}</li>
    <li>${L('Za ztrátu prostředků, klíčů nebo dat nese odpovědnost uživatel. Transakce v blockchainu nejdou vrátit.', 'Users are responsible for any loss of funds, keys or data. Blockchain transactions cannot be reversed.')}</li>
    <li>${L('Dodržování předpisů ve vaší zemi, včetně daní a nařízení o kryptoaktivech, je na vás.', 'Complying with the rules in your country, including taxes and crypto-asset regulation, is up to you.')}</li>
    <li>${L('Web nepoužívá cookies ani sledování. Volba jazyka se ukládá jen ve vašem prohlížeči.', 'This site uses no cookies or tracking. The language choice is stored only in your browser.')}</li>
  </ul>
</div></section>`,
    },

    // ------------------------------------------------------------------ kontakt
    {
      slug: 'contact', label: L('Kontakt', 'Contact'), footerOnly: true,
      title: L('Kontakt', 'Contact'),
      desc: L('Komunita kolem sítě Quinvium.', 'The community around the Quinvium network.'),
      lead: L('Quinvium je decentralizovaná síť bez firmy a bez vlastníka. Komunitní kanály budou doplněny.', 'Quinvium is a decentralised network with no company and no owner. Community channels will be listed here.'),
      body: `
<section class="sec"><div class="wrap">
  <div class="cards c3">
    ${card('globe', L('E-mail', 'E-mail'), `<span class="placeholder">${L('bude doplněn', 'to be added')}</span>`)}
    ${card('users', L('Komunita', 'Community'), `<span class="placeholder">${L('bude doplněna', 'to be added')}</span>`)}
    ${card('code', L('Zdrojový kód', 'Source code'), '<a href="https://github.com/Lakylife/quinvium">github.com/Lakylife/quinvium</a>, issues and pull requests welcome.')}
  </div>
  <p class="muted">${L('Kdo po vás chce obnovovací frázi nebo poslání mincí „na ověření“, je podvodník.', 'Anyone who asks for your recovery phrase or for coins “for verification” is a scammer.')}</p>
</div></section>`,
    },
  ];
}

/** Ilustrace v úvodu: vrstvené průsvitné pětiúhelníky kolem znaku, plné barvy bez přechodů. */
function heroArt() {
  const pent = (cx, cy, r, rot = 0) => {
    const pts = [];
    for (let i = 0; i < 5; i += 1) {
      const a = ((-90 + rot + i * 72) * Math.PI) / 180;
      pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  };
  return `<svg viewBox="0 0 480 440" class="art">
  <polygon class="p1 drift" points="${pent(240, 225, 205, 0)}"/>
  <polygon class="p2 drift2" points="${pent(240, 225, 160, 36)}"/>
  <polygon class="p3" points="${pent(240, 225, 112, 0)}"/>
  <polygon class="f1 float" points="${pent(70, 80, 30, 12)}"/>
  <polygon class="f2 float2" points="${pent(420, 360, 38, -20)}"/>
  <polygon class="f3 float" points="${pent(430, 90, 18, 30)}"/>
  <polygon class="f4 float2" points="${pent(60, 370, 16, 0)}"/>
  <g class="orbit"><circle class="o" cx="240" cy="20" r="7"/><circle class="o o2" cx="445" cy="225" r="5"/></g>
  <g transform="translate(180 165) scale(1.875)"><path class="mark" d="M32 2.75L59.58 22.79L49.05 55.21L14.95 55.21L4.42 22.79ZM18.21 27.27L23.48 43.48L40.52 43.48L45.79 27.27L32 17.25ZM39.37 33.81L55.24 55.66L47.56 61.24L31.69 39.4Z"/></g>
</svg>`;
}

/** Graf vydávání: vytěžené QU podle let při 15 s na blok. */
export function emissionChart(L) {
  const bpy = (365.25 * 86400) / 15;
  const W = 560; const H = 260; const px = 44; const py = 20;
  const pts = [];
  for (let y = 0; y <= 30; y += 0.5) {
    let left = y * bpy; let s = 0; let r = 4;
    while (left > 0) { const take = Math.min(left, 8e6); s += take * r; left -= take; r /= 2; }
    pts.push([px + (y / 30) * (W - px - 10), H - py - (s / 64e6) * (H - 2 * py)]);
  }
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${px},${H - py} ${line} ${W - 10},${H - py}`;
  const yTicks = [0, 16, 32, 48, 64].map((v) => { const y = H - py - (v / 64) * (H - 2 * py); return `<line class="gl" x1="${px}" x2="${W - 10}" y1="${y}" y2="${y}"/><text x="${px - 8}" y="${y + 4}" text-anchor="end">${v}</text>`; }).join('');
  const xTicks = [0, 5, 10, 15, 20, 25, 30].map((v) => `<text x="${px + (v / 30) * (W - px - 10)}" y="${H - 2}" text-anchor="middle">${v}</text>`).join('');
  const halvings = [1, 2, 3, 4].map((e) => { const x = px + ((e * 3.8026) / 30) * (W - px - 10); return `<line class="hv" x1="${x}" x2="${x}" y1="${py}" y2="${H - py}"/>`; }).join('');
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${L('Vytěžené QU v milionech podle let od startu', 'Mined QU in millions by years since launch')}">
  ${yTicks}${halvings}<polygon class="area" points="${area}"/><polyline class="ln" points="${line}"/>${xTicks}
</svg><figcaption>${L('Vytěžené QU (miliony) podle let od startu, svislé čáry jsou půlení odměny.', 'Mined QU (millions) by years since launch; vertical lines mark reward halvings.')}</figcaption></figure>`;
}
