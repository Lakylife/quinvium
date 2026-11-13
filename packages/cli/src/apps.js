// Aplikace sítě z příkazové řádky, stejné jako na stránce Aplikace v Exploreru: notář, certifikáty, dodavatelský
// řetězec, úschova plateb, hlasování, jména adres, vlastní token, sbírka NFT a peněženka s více podpisy.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { ethers } from 'ethers';
import { CliError, TX_WAIT_MS, dateText, hashOf, pairs, parseAmount, parseId, short, table, units } from './context.js';
import { L } from './i18n.js';
import { confirm, encode, submit } from './tx.js';
import { walletAddress } from './wallets.js';

const DAY_S = 86400;
const NAME_WAIT_POLL_MS = 3000;
const ESCROW_DAYS = 14;
const POLL_DAYS = 7;
const MAX_YEARS = 10;
const now = () => Math.floor(Date.now() / 1000);
const ID = {
  item: { cs: 'číslo položky', en: 'item number' }, deal: { cs: 'číslo obchodu', en: 'deal number' }, poll: { cs: 'číslo hlasování', en: 'poll number' },
  proposal: { cs: 'číslo návrhu', en: 'proposal number' }, option: { cs: 'číslo možnosti od 1', en: 'option number from 1' }, nft: { cs: 'číslo položky', en: 'item number' },
};

/** Události z účtenky podle ABI kontraktu. Logy jiných kontraktů se přeskočí. */
function events(result, contract) {
  return (result.logs ?? []).map((log) => {
    if (log.address.toLowerCase() !== String(contract.target).toLowerCase()) return null;
    try { return contract.interface.parseLog(log); } catch { return null; }
  }).filter(Boolean);
}
const eventArg = (result, contract, name, key) => events(result, contract).find((e) => e.name === name)?.args?.[key];

/** Výsledek transakce. S --no-wait ještě není v bloku, číslo nové položky ani adresa se tedy neznají. */
function finish(ctx, result, text, data = {}) {
  if (result.pending) {
    ctx.print(result, L(`Odesláno: ${result.hash}\nVýsledek ukáže: quinvium tx ${result.hash}`, `Sent: ${result.hash}\nSee the result with: quinvium tx ${result.hash}`));
    return;
  }
  ctx.print({ ...result, ...data }, text);
}

/** Počet dní do budoucna jako časová značka. */
function daysFrom(ctx, fallback) {
  const text = String(ctx.opts.days ?? fallback).replace(',', '.');
  const n = Number(text);
  if (!(n > 0 && n <= 36500)) throw new CliError(L('Volba --days musí být kladné číslo dní.', 'The --days option must be a positive number of days.'));
  return BigInt(now() + Math.round(n * DAY_S));
}

function need(value, cs, en) {
  if (value === undefined || value === null || value === '') throw new CliError(L(`Chybí ${cs}.`, `Missing ${en}.`));
  return value;
}

/** Text podúkolu bez platného podúkolu: nápověda aplikace, chyba jen u neznámého názvu. */
function usageOf(app, sub) {
  const text = app.usage();
  if (sub && sub !== 'help') throw new CliError(L(`Neznámý příkaz ${app.name} ${sub}.\n\n${text}`, `Unknown command ${app.name} ${sub}.\n\n${text}`));
  console.log(text);
}

// ------------------------------------------------------------------- notář
/** Otisk souboru (SHA-256 obsahu jako v Exploreru), hodnota 0x… nebo text z --text (keccak256). */
function fingerprint(ctx, input) {
  if (ctx.opts.text !== undefined) return { hash: ethers.id(ctx.opts.text), source: L('text z --text', 'text from --text') };
  need(input, 'soubor, otisk 0x… nebo --text "…"', 'a file, a 0x… fingerprint or --text "…"');
  if (/^0x[0-9a-fA-F]{64}$/.test(input)) return { hash: input.toLowerCase(), source: L('zadaný otisk', 'given fingerprint') };
  if (!existsSync(input) || !statSync(input).isFile()) {
    throw new CliError(L(`Soubor ${input} neexistuje. Text zapíšete přes --text "…".`, `The file ${input} does not exist. To record text, use --text "…".`));
  }
  return { hash: `0x${createHash('sha256').update(readFileSync(input)).digest('hex')}`, source: L(`soubor ${basename(input)} (SHA-256)`, `file ${basename(input)} (SHA-256)`) };
}

const notary = {
  name: 'notary',
  usage: () => L(`Notář: doloží, že dokument existoval v daném čase a beze změny. Do sítě jde jen otisk, ne obsah.

  quinvium notary stamp <soubor> [--note "…"]       zapíše otisk souboru
  quinvium notary stamp --text "…"                 zapíše otisk textu
  quinvium notary verify <soubor> [--author 0x…]   ověří zápis
  quinvium notary revoke <soubor> [--reason "…"]   odvolá vlastní zápis

Místo souboru jde zadat i otisk 0x… Záznam dokazuje existenci a kdo ji zapsal, ne autorství.`, `Notary: proves that a document existed at a given time, unchanged. Only its fingerprint goes on chain, not the content.

  quinvium notary stamp <file> [--note "…"]        records the file fingerprint
  quinvium notary stamp --text "…"                 records the fingerprint of a text
  quinvium notary verify <file> [--author 0x…]     checks the record
  quinvium notary revoke <file> [--reason "…"]     revokes your own record

A 0x… fingerprint can be given instead of a file. The record proves existence and who recorded it, not authorship.`),
  async stamp(ctx, [input]) {
    const f = fingerprint(ctx, input);
    await ctx.connect();
    const c = ctx.at('Notary');
    if ((await c.verify(f.hash, walletAddress(ctx)))[0]) throw new CliError(L('Tento otisk už máte zapsaný. Ověří ho: quinvium notary verify', 'You have already recorded this fingerprint. Check it with: quinvium notary verify'));
    const note = ctx.opts.note ?? '';
    const result = await submit(ctx, { to: c.target, data: encode(c, 'notarize', [f.hash, note]) }, [[L('Zápis', 'Record'), f.source], [L('Otisk', 'Fingerprint'), f.hash], note ? [L('Poznámka', 'Note'), note] : null]);
    finish(ctx, result, L('Otisk je zapsaný. Kdokoli ho ověří stejným souborem: quinvium notary verify <soubor>', 'The fingerprint is recorded. Anyone can check it with the same file: quinvium notary verify <file>'), { hash: f.hash, author: walletAddress(ctx) });
  },
  async verify(ctx, [input]) {
    const f = fingerprint(ctx, input);
    await ctx.connect();
    const c = ctx.at('Notary');
    const author = ctx.opts.author ? await ctx.address(ctx.opts.author) : await c.firstAuthor(f.hash);
    const [exists, at, revokedAt, note] = await c.verify(f.hash, author);
    const data = { hash: f.hash, author: exists ? author : null, exists, timestamp: at, revokedAt, note };
    if (!exists) {
      ctx.print(data, pairs([[L('Stav', 'Status'), ctx.opts.author ? L('tato adresa otisk nezapsala', 'this address has not recorded the fingerprint') : L('nenalezeno, otisk nikdo nezapsal', 'not found, nobody recorded this fingerprint')], [L('Otisk', 'Fingerprint'), f.hash], [L('Zdroj', 'Source'), f.source]]));
      return;
    }
    ctx.print(data, pairs([
      [L('Stav', 'Status'), Number(revokedAt) ? L('ODVOLÁNO', 'REVOKED') : L('platné', 'valid')], [L('Zapsal', 'Recorded by'), author], [L('Zapsáno', 'Recorded'), dateText(at)],
      Number(revokedAt) ? [L('Odvoláno', 'Revoked'), dateText(revokedAt)] : null, note ? [L('Poznámka', 'Note'), note] : null, [L('Otisk', 'Fingerprint'), f.hash], [L('Zdroj', 'Source'), f.source],
    ]));
  },
  async revoke(ctx, [input]) {
    const f = fingerprint(ctx, input);
    await ctx.connect();
    const c = ctx.at('Notary');
    const reason = ctx.opts.reason ?? '';
    const result = await submit(ctx, { to: c.target, data: encode(c, 'revoke', [f.hash, reason]) }, [[L('Odvolat zápis', 'Revoke record'), f.hash], reason ? [L('Důvod', 'Reason'), reason] : null, [L('Pozor', 'Note'), L('dál bude vidět, že zápis existoval a kdy byl odvolán', 'it stays visible that the record existed and when it was revoked')]]);
    ctx.print(result, L('Zápis je odvolaný.', 'The record is revoked.'));
  },
};

// ------------------------------------------------------------------- certifikáty
const credential = {
  name: 'credential',
  usage: () => L(`Certifikáty: ověřitelné diplomy a licence. Jméno vydavatele si každý uvádí sám, proto ověřujte adresu vydavatele z jeho oficiálního webu.

  quinvium credential register <název vydavatele> [--website https://…]   jednou za adresu
  quinvium credential issue <číslo dokladu> <adresa držitele> [--type Bakalář] [--days 365]
  quinvium credential verify <číslo dokladu> <adresa vydavatele>
  quinvium credential revoke <číslo dokladu> [--reason "…"]

Číslo dokladu volí vydavatel, třeba číslo diplomu. Bez --days platí doklad bez omezení.`, `Credentials: verifiable diplomas and licences. Anyone can claim an issuer name, so check the issuer address from its official website.

  quinvium credential register <issuer name> [--website https://…]       once per address
  quinvium credential issue <credential number> <holder address> [--type Bachelor] [--days 365]
  quinvium credential verify <credential number> <issuer address>
  quinvium credential revoke <credential number> [--reason "…"]

The issuer chooses the number, for example the diploma number. Without --days the credential does not expire.`),
  async register(ctx, [name]) {
    need(name, 'název vydavatele', 'the issuer name');
    await ctx.connect();
    const c = ctx.at('Credentials');
    const website = ctx.opts.website ?? '';
    const result = await submit(ctx, { to: c.target, data: encode(c, 'registerIssuer', [name, website]) }, [[L('Vydavatel', 'Issuer'), name], website ? [L('Web', 'Website'), website] : null, [L('Adresa vydavatele', 'Issuer address'), walletAddress(ctx)]]);
    finish(ctx, result, L('Vydavatel je zaregistrovaný. Doklady vydá: quinvium credential issue <číslo> <adresa držitele>', 'The issuer is registered. Issue credentials with: quinvium credential issue <number> <holder address>'), { issuer: walletAddress(ctx) });
  },
  async issue(ctx, [id, holder]) {
    need(id, 'číslo dokladu', 'the credential number');
    const subject = await ctx.address(need(holder, 'adresa držitele', 'the holder address'));
    await ctx.connect();
    const c = ctx.at('Credentials');
    if (!Number((await c.issuers(walletAddress(ctx))).registeredAt)) throw new CliError(L('Nejdřív se zaregistrujte jako vydavatel: quinvium credential register <název>', 'Register as an issuer first: quinvium credential register <name>'));
    const expires = ctx.opts.days === undefined ? 0n : daysFrom(ctx);
    const type = ctx.opts.type ?? 'obecny';
    const result = await submit(ctx, { to: c.target, data: encode(c, 'issue', [hashOf(id), subject, hashOf(type), expires]) },
      [[L('Doklad', 'Credential'), id], [L('Držitel', 'Holder'), subject], [L('Typ', 'Type'), ctx.opts.type ?? L('obecný', 'general')], [L('Platí do', 'Valid until'), expires ? dateText(expires) : L('bez omezení', 'no limit')]]);
    finish(ctx, result, L(`Doklad je vydaný. Ověří ho: quinvium credential verify ${id} ${walletAddress(ctx)}`, `The credential is issued. Check it with: quinvium credential verify ${id} ${walletAddress(ctx)}`), { id: hashOf(id), issuer: walletAddress(ctx), subject });
  },
  async verify(ctx, [id, issuerText]) {
    need(id, 'číslo dokladu', 'the credential number');
    const issuer = await ctx.address(need(issuerText, 'adresa vydavatele', 'the issuer address'));
    await ctx.connect();
    const c = ctx.at('Credentials');
    const r = await c.get(issuer, hashOf(id));
    if (!Number(r.issuedAt)) {
      ctx.print({ id: hashOf(id), issuer, issued: false }, pairs([[L('Stav', 'Status'), L('tento vydavatel doklad nevydal', 'this issuer has not issued it')], [L('Vydavatel', 'Issuer'), issuer]]));
      return;
    }
    const [valid, info] = await Promise.all([c.isValid(issuer, hashOf(id)), c.issuers(issuer)]);
    const state = valid ? L('platný', 'valid') : Number(r.revokedAt) ? L('ODVOLANÝ', 'REVOKED') : L('PLATNOST VYPRŠELA', 'EXPIRED');
    ctx.print({ id: hashOf(id), issuer, issued: true, valid, subject: r.subject, issuedAt: r.issuedAt, expiresAt: r.expiresAt, revokedAt: r.revokedAt, issuerName: info.name, website: info.website }, pairs([
      [L('Stav', 'Status'), state], [L('Vydavatel o sobě uvádí', 'Issuer says it is'), info.name || '—'], info.website ? [L('Web vydavatele', 'Issuer website'), info.website] : null, [L('Adresa vydavatele', 'Issuer address'), issuer],
      [L('Držitel', 'Holder'), r.subject], [L('Vydáno', 'Issued'), dateText(r.issuedAt)], [L('Platí do', 'Valid until'), Number(r.expiresAt) ? dateText(r.expiresAt) : L('bez omezení', 'no limit')],
      Number(r.revokedAt) ? [L('Odvoláno', 'Revoked'), dateText(r.revokedAt)] : null,
    ]));
  },
  async revoke(ctx, [id]) {
    need(id, 'číslo dokladu', 'the credential number');
    await ctx.connect();
    const c = ctx.at('Credentials');
    const reason = ctx.opts.reason ?? '';
    finish(ctx, await submit(ctx, { to: c.target, data: encode(c, 'revoke', [hashOf(id), reason]) }, [[L('Odvolat doklad', 'Revoke credential'), id], reason ? [L('Důvod', 'Reason'), reason] : null]), L('Doklad je odvolaný.', 'The credential is revoked.'));
  },
};

// ------------------------------------------------------------------- dodavatelský řetězec
const supply = {
  name: 'supply',
  usage: () => L(`Dodavatelský řetězec: celá cesta zboží od výrobce k zákazníkovi. Předání musí potvrdit obě strany.

  quinvium supply create <označení zboží>           nová položka, třeba KAVA-001
  quinvium supply show <číslo>                      stav a celá cesta
  quinvium supply step <číslo> <místo> <stav> [--evidence <soubor>]   krok přidá ten, kdo zboží drží
  quinvium supply offer <číslo> <adresa>            nabídne předání
  quinvium supply accept <číslo>                    příjemce zboží převezme
  quinvium supply close <číslo>                     uzavře položku`, `Supply chain: the journey of goods from maker to customer. Both sides confirm each handover.

  quinvium supply create <product code>             new item, e.g. COFFEE-001
  quinvium supply show <number>                     status and the whole journey
  quinvium supply step <number> <location> <status> [--evidence <file>]   added by the current holder
  quinvium supply offer <number> <address>          offers a handover
  quinvium supply accept <number>                   the recipient takes the item over
  quinvium supply close <number>                    closes the item`),
  async create(ctx, [sku]) {
    need(sku, 'označení zboží', 'the product code');
    await ctx.connect();
    const c = ctx.at('SupplyChain');
    const result = await submit(ctx, { to: c.target, data: encode(c, 'create', [sku]) }, [[L('Nová položka', 'New item'), sku]]);
    const id = eventArg(result, c, 'ItemCreated', 'id');
    finish(ctx, result, L(`Položka má číslo ${id}. Cestu ukáže: quinvium supply show ${id}`, `The item number is ${id}. Show its journey: quinvium supply show ${id}`), { id });
  },
  async show(ctx, [text]) {
    const id = parseId(text, ID.item);
    await ctx.connect();
    const c = ctx.at('SupplyChain');
    const it = await c.getItem(id).catch(() => null);
    if (!it || !Number(it.createdAt)) throw new CliError(L(`Položka ${id} neexistuje.`, `Item ${id} does not exist.`));
    const steps = [];
    for (let i = 0; i < Number(it.stepCount); i++) {
      const s = await c.getStep(id, i);
      steps.push({ time: s.time, location: s.location, status: s.status, actor: s.actor, evidence: s.evidence });
    }
    const handing = it.pendingCustodian !== ethers.ZeroAddress;
    const state = it.closed ? L('uzavřená', 'closed') : handing ? L('čeká na převzetí', 'awaiting acceptance') : L('na cestě', 'in transit');
    const text2 = [pairs([[L('Zboží', 'Product'), it.sku], [L('Stav', 'Status'), state], [L('Vytvořil', 'Created by'), it.creator], [L('Vytvořeno', 'Created'), dateText(it.createdAt)], [L('Teď drží', 'Now held by'), it.custodian], handing ? [L('Předává se adrese', 'Being handed to'), it.pendingCustodian] : null])];
    if (steps.length) text2.push('', table([L('Čas', 'Time'), L('Místo', 'Location'), L('Stav', 'Status'), L('Zapsal', 'By')], steps.map((s) => [dateText(s.time), s.location, s.status, short(s.actor)])));
    ctx.print({ id, sku: it.sku, creator: it.creator, custodian: it.custodian, pendingCustodian: handing ? it.pendingCustodian : null, closed: it.closed, steps }, text2.join('\n'));
  },
  async step(ctx, [text, location, status]) {
    const id = parseId(text, ID.item);
    need(location, 'místo', 'the location');
    need(status, 'stav, třeba expedováno', 'the status, e.g. shipped');
    const evidence = ctx.opts.evidence ? fingerprint({ opts: {} }, ctx.opts.evidence).hash : ethers.ZeroHash;
    await ctx.connect();
    const c = ctx.at('SupplyChain');
    finish(ctx, await submit(ctx, { to: c.target, data: encode(c, 'addStep', [id, location, status, evidence]) }, [[L('Položka', 'Item'), id], [L('Místo', 'Location'), location], [L('Stav', 'Status'), status], evidence !== ethers.ZeroHash ? [L('Doklad', 'Evidence'), evidence] : null]), L('Krok je zapsaný.', 'The step is recorded.'));
  },
  async offer(ctx, [text, to]) {
    const id = parseId(text, ID.item);
    const target = await ctx.address(need(to, 'adresa příjemce', 'the recipient address'));
    await ctx.connect();
    const c = ctx.at('SupplyChain');
    finish(ctx, await submit(ctx, { to: c.target, data: encode(c, 'offerTransfer', [id, target]) }, [[L('Položka', 'Item'), id], [L('Předat adrese', 'Hand to'), target]]), L(`Předání čeká na příjemce: quinvium supply accept ${id}`, `The handover waits for the recipient: quinvium supply accept ${id}`));
  },
  async accept(ctx, [text]) {
    const id = parseId(text, ID.item);
    await ctx.connect();
    const c = ctx.at('SupplyChain');
    finish(ctx, await submit(ctx, { to: c.target, data: encode(c, 'acceptTransfer', [id]) }, [[L('Převzít položku', 'Accept item'), id]]), L('Zboží je převzaté.', 'The item is accepted.'));
  },
  async close(ctx, [text]) {
    const id = parseId(text, ID.item);
    await ctx.connect();
    const c = ctx.at('SupplyChain');
    finish(ctx, await submit(ctx, { to: c.target, data: encode(c, 'close', [id]) }, [[L('Uzavřít položku', 'Close item'), id], [L('Pozor', 'Note'), L('uzavřená položka už další kroky nepřijme', 'a closed item accepts no further steps')]]), L('Položka je uzavřená.', 'The item is closed.'));
  },
};

// ------------------------------------------------------------------- úschova plateb
const ESCROW_STATES = () => [L('neexistuje', 'does not exist'), L('zaplaceno, čeká na plnění', 'paid, awaiting delivery'), L('spor', 'disputed'), L('uzavřeno', 'closed')];
const escrowAction = (fn, label, done) => async (ctx, [text]) => {
  const id = parseId(text, ID.deal);
  await ctx.connect();
  const c = ctx.at('Escrow');
  finish(ctx, await submit(ctx, { to: c.target, data: encode(c, fn, [id]) }, [[label(), id]]), done());
};

const escrow = {
  name: 'escrow',
  usage: () => L(`Úschova plateb: peníze drží kontrakt do splnění dohody. Ve sporu rozhodne předem zvolený rozhodce. Když do 90 dnů nerozhodne, strany se rozdělí napůl.

  quinvium escrow create <prodávající> <rozhodce> <částka> [--days 14] [--fee-percent 1] [--note "…"]
  quinvium escrow show <číslo>
  quinvium escrow release <číslo>      kupující uvolní platbu prodávajícímu
  quinvium escrow refund <číslo>       prodávající vrátí kdykoli, kupující až po lhůtě
  quinvium escrow dispute <číslo>      otevře spor
  quinvium escrow resolve <číslo> <procent pro prodávajícího>   jen rozhodce
  quinvium escrow settle <číslo>       po 90 dnech sporu bez rozhodnutí napůl
  quinvium escrow withdraw             vybere peníze z uzavřených obchodů`, `Escrow: the contract holds the money until the deal is done. An agreed arbiter settles disputes. Without a ruling in 90 days the parties split the money.

  quinvium escrow create <seller> <arbiter> <amount> [--days 14] [--fee-percent 1] [--note "…"]
  quinvium escrow show <number>
  quinvium escrow release <number>     the buyer releases the payment to the seller
  quinvium escrow refund <number>      the seller can refund any time, the buyer after the deadline
  quinvium escrow dispute <number>     opens a dispute
  quinvium escrow resolve <number> <percent for the seller>   arbiter only
  quinvium escrow settle <number>      splits the money after 90 days of an unresolved dispute
  quinvium escrow withdraw             withdraws money from closed deals`),
  async create(ctx, [sellerText, arbiterText, amountText]) {
    const seller = await ctx.address(need(sellerText, 'adresa prodávajícího', 'the seller address'));
    const arbiter = await ctx.address(need(arbiterText, 'adresa rozhodce', 'the arbiter address'));
    const value = parseAmount(need(amountText, 'částka', 'the amount'));
    const pct = Number(String(ctx.opts['fee-percent'] ?? 1).replace(',', '.'));
    if (!(pct >= 0 && pct <= 10)) throw new CliError(L('Odměna rozhodce --fee-percent smí být 0 až 10 %.', 'The arbiter fee --fee-percent can be 0 to 10%.'));
    const deadline = daysFrom(ctx, ESCROW_DAYS);
    await ctx.connect();
    const c = ctx.at('Escrow');
    const result = await submit(ctx, { to: c.target, value, data: encode(c, 'create', [seller, arbiter, deadline, Math.round(pct * 100), ctx.opts.note ?? 'quinvium']) },
      [[L('Do úschovy', 'Into escrow'), `${units(value)} ${ctx.symbol}`], [L('Prodávající', 'Seller'), seller], [L('Rozhodce', 'Arbiter'), `${arbiter}, ${L('odměna', 'fee')} ${pct} % ${L('jen při sporu', 'only in a dispute')}`], [L('Lhůta', 'Deadline'), dateText(deadline)]]);
    const id = eventArg(result, c, 'Created', 'id');
    finish(ctx, result, L(`Obchod má číslo ${id}. Po dodání uvolněte platbu: quinvium escrow release ${id}`, `The deal number is ${id}. After delivery release the payment: quinvium escrow release ${id}`), { id });
  },
  async show(ctx, [text]) {
    const id = parseId(text, ID.deal);
    await ctx.connect();
    const d = await ctx.at('Escrow').get(id);
    if (!Number(d.state)) throw new CliError(L(`Obchod ${id} neexistuje.`, `Deal ${id} does not exist.`));
    ctx.print({ id, state: Number(d.state), buyer: d.buyer, seller: d.seller, arbiter: d.arbiter, amount: d.amount, deadline: d.deadline, disputedAt: d.disputedAt, arbiterFeeBps: d.arbiterFeeBps, note: d.note }, pairs([
      [L('Stav', 'Status'), ESCROW_STATES()[Number(d.state)]], [L('Částka', 'Amount'), `${units(d.amount)} ${ctx.symbol}`], [L('Kupující', 'Buyer'), d.buyer], [L('Prodávající', 'Seller'), d.seller],
      [L('Rozhodce', 'Arbiter'), `${d.arbiter}, ${Number(d.arbiterFeeBps) / 100} %`], [L('Lhůta', 'Deadline'), dateText(d.deadline)], Number(d.disputedAt) ? [L('Spor otevřen', 'Dispute opened'), dateText(d.disputedAt)] : null, d.note ? [L('Poznámka', 'Note'), d.note] : null,
    ]));
  },
  release: escrowAction('release', () => L('Uvolnit platbu prodávajícímu, obchod', 'Release the payment to the seller, deal'), () => L('Platba je uvolněná. Prodávající si ji vybere: quinvium escrow withdraw', 'The payment is released. The seller withdraws it with: quinvium escrow withdraw')),
  refund: escrowAction('refund', () => L('Vrátit platbu kupujícímu, obchod', 'Refund the buyer, deal'), () => L('Platba se vrací kupujícímu. Vybere si ji: quinvium escrow withdraw', 'The payment goes back to the buyer, who withdraws it with: quinvium escrow withdraw')),
  dispute: escrowAction('dispute', () => L('Otevřít spor, obchod', 'Open a dispute, deal'), () => L('Spor je otevřený. Rozhodne rozhodce.', 'The dispute is open. The arbiter decides.')),
  settle: escrowAction('settleAbandoned', () => L('Rozdělit napůl bez rozhodce, obchod', 'Split without the arbiter, deal'), () => L('Obchod je rozdělený napůl. Každý si vybere: quinvium escrow withdraw', 'The deal is split in half. Each side withdraws with: quinvium escrow withdraw')),
  async resolve(ctx, [text, pctText]) {
    const id = parseId(text, ID.deal);
    const pct = Number(String(need(pctText, 'podíl prodávajícího v %', 'the seller share in %')).replace(',', '.'));
    if (!(pct >= 0 && pct <= 100)) throw new CliError(L('Podíl prodávajícího musí být 0 až 100 %.', 'The seller share must be 0 to 100%.'));
    await ctx.connect();
    const c = ctx.at('Escrow');
    finish(ctx, await submit(ctx, { to: c.target, data: encode(c, 'resolve', [id, Math.round(pct * 100)]) }, [[L('Rozhodnutí sporu, obchod', 'Ruling, deal'), id], [L('Prodávající dostane', 'Seller gets'), `${pct} %`], [L('Kupující dostane', 'Buyer gets'), `${100 - pct} %`]]), L('Spor je rozhodnutý. Strany si vyberou: quinvium escrow withdraw', 'The dispute is settled. The parties withdraw with: quinvium escrow withdraw'));
  },
  async withdraw(ctx) {
    await ctx.connect();
    const c = ctx.at('Escrow');
    const owed = await c.credits(walletAddress(ctx));
    if (!owed) throw new CliError(L('V úschově na vás nic nečeká.', 'Nothing is waiting for you in escrow.'));
    finish(ctx, await submit(ctx, { to: c.target, data: encode(c, 'withdraw', []) }, [[L('Výběr z úschovy', 'Withdraw from escrow'), `${units(owed)} ${ctx.symbol}`]]), L('Vybráno.', 'Withdrawn.'));
  },
};

// ------------------------------------------------------------------- hlasování
const poll = {
  name: 'poll',
  usage: () => L(`Hlasování, které nejde přepsat. Každá adresa má jeden hlas a hlasy jsou veřejné, tajné volby se pro něj nehodí.

  quinvium poll create "<otázka>" <možnost> <možnost> … [--days 7]
  quinvium poll show <číslo>                        výsledky
  quinvium poll vote <číslo> <možnost od 1>

Možnosti jdou zadat i jako jeden text oddělený čárkami.`, `Voting that cannot be rewritten. One vote per address and the votes are public, so it does not suit secret ballots.

  quinvium poll create "<question>" <option> <option> … [--days 7]
  quinvium poll show <number>                       results
  quinvium poll vote <number> <option from 1>

The options can also be one text separated by commas.`),
  async create(ctx, [title, ...rest]) {
    need(title, 'otázka', 'the question');
    const choices = (rest.length === 1 ? rest[0].split(',') : rest).map((x) => x.trim()).filter(Boolean);
    if (choices.length < 2) throw new CliError(L('Hlasování potřebuje aspoň dvě možnosti.', 'A poll needs at least two options.'));
    const ends = daysFrom(ctx, POLL_DAYS);
    await ctx.connect();
    const c = ctx.at('Polls');
    const result = await submit(ctx, { to: c.target, data: encode(c, 'create', [title, choices, ethers.ZeroHash, ends]) }, [[L('Otázka', 'Question'), title], [L('Možnosti', 'Options'), choices.map((x, i) => `${i + 1}. ${x}`).join(', ')], [L('Konec', 'Ends'), dateText(ends)]]);
    const id = eventArg(result, c, 'PollCreated', 'id');
    finish(ctx, result, L(`Hlasování má číslo ${id}. Hlasuje se: quinvium poll vote ${id} <možnost>`, `The poll number is ${id}. Vote with: quinvium poll vote ${id} <option>`), { id });
  },
  async show(ctx, [text]) {
    const id = parseId(text, ID.poll);
    await ctx.connect();
    const [p, choices, votes] = await ctx.at('Polls').get(id);
    if (!Number(p.endsAt)) throw new CliError(L(`Hlasování ${id} neexistuje.`, `Poll ${id} does not exist.`));
    const open = Number(p.endsAt) > now();
    const total = votes.reduce((a, b) => a + b, 0n);
    const rows = [...choices].map((x, i) => [i + 1, x, votes[i], total ? `${(Number((votes[i] * 1000n) / total) / 10).toFixed(1)} %` : '—']);
    ctx.print({ id, title: p.title, creator: p.creator, endsAt: p.endsAt, open, choices: [...choices], votes: [...votes] }, [
      pairs([[L('Otázka', 'Question'), p.title], [L('Stav', 'Status'), open ? L('probíhá', 'open') : L('skončilo', 'ended')], [L('Konec', 'Ends'), dateText(p.endsAt)], [L('Založil', 'Created by'), p.creator], [L('Hlasů', 'Votes'), total]]), '',
      table(['#', L('Možnost', 'Option'), L('Hlasy', 'Votes'), '%'], rows, [0, 2, 3]),
    ].join('\n'));
  },
  async vote(ctx, [text, optionText]) {
    const id = parseId(text, ID.poll);
    const option = parseId(optionText, ID.option);
    if (option < 1n) throw new CliError(L('Možnosti se číslují od 1.', 'Options are numbered from 1.'));
    await ctx.connect();
    const c = ctx.at('Polls');
    const [p, choices] = await c.get(id);
    if (!Number(p.endsAt)) throw new CliError(L(`Hlasování ${id} neexistuje.`, `Poll ${id} does not exist.`));
    if (option > BigInt(choices.length)) throw new CliError(L(`Hlasování ${id} má jen ${choices.length} možnosti.`, `Poll ${id} has only ${choices.length} options.`));
    if (await c.voted(id, walletAddress(ctx))) throw new CliError(L('V tomto hlasování už jste hlasovali.', 'You have already voted in this poll.'));
    finish(ctx, await submit(ctx, { to: c.target, data: encode(c, 'vote', [id, option - 1n, []]) }, [[L('Otázka', 'Question'), p.title], [L('Hlas pro', 'Vote for'), `${option}. ${choices[Number(option) - 1]}`], [L('Pozor', 'Note'), L('hlas je veřejný a změnit ho nejde', 'the vote is public and cannot be changed')]]), L('Hlas je zapsaný.', 'The vote is recorded.'));
  },
};

// ------------------------------------------------------------------- jména adres
const cleanName = (text) => need(text, 'jméno', 'the name').toLowerCase().replace(/\.qu$/, '');
const yearsOf = (ctx) => {
  const n = Number(ctx.opts.years ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > MAX_YEARS) throw new CliError(L(`Volba --years musí být 1 až ${MAX_YEARS}.`, `The --years option must be 1 to ${MAX_YEARS}.`));
  return BigInt(n);
};

/** Registrace má dva kroky: závazek s tajným číslem a po ochranné lhůtě odhalení. Nikdo tak jméno nepředběhne. */
async function registerName(ctx, [text]) {
  const name = cleanName(text);
  if (ctx.opts['no-wait']) throw new CliError(L('Registrace jména čeká na dva bloky, bez --no-wait.', 'A name registration waits for two blocks, use it without --no-wait.'));
  await ctx.connect();
  const c = ctx.at('AetherNames');
  if (!(await c.valid(name))) throw new CliError(L(`Neplatné jméno ${name}. Povolena jsou malá písmena, číslice a pomlčka, 3 až 32 znaků.`, `Invalid name ${name}: 3 to 32 lowercase letters, digits or hyphens.`));
  if (!(await c.available(name))) throw new CliError(L(`Jméno ${name}.qu je obsazené. Vlastníka ukáže: quinvium name info ${name}`, `The name ${name}.qu is taken. See the owner: quinvium name info ${name}`));
  const me = walletAddress(ctx);
  const target = ctx.opts.target ? await ctx.address(ctx.opts.target) : me;
  const years = yearsOf(ctx);
  const cost = (await c.pricePerYear(name)) * years;
  ctx.note(pairs([[L('Jméno', 'Name'), `${name}.qu`], [L('Ukazuje na', 'Points to'), target], [L('Na', 'For'), L(`${years} ${years === 1n ? 'rok' : years < 5n ? 'roky' : 'let'}`, `${years} year${years === 1n ? '' : 's'}`)],
    [L('Cena', 'Price'), `${units(cost)} ${ctx.symbol}, ${L('spálí se', 'burned')}`], [L('Postup', 'Steps'), L('dvě transakce a mezi nimi asi minuta čekání, aby jméno nikdo nepředběhl', 'two transactions with about a minute between them, so nobody can front-run the name')]]));
  await confirm(ctx, L('Registrovat?', 'Register?'));
  const secret = ethers.hexlify(randomBytes(32));
  const commit = await submit(ctx, { to: c.target, data: encode(c, 'commit', [await c.commitment(name, me, target, secret)]) }, [], { confirmed: true, label: L('Závazek', 'Commitment') });
  const committed = Number((await ctx.provider.getBlock(commit.block)).timestamp);
  const age = Number(await c.MIN_COMMIT_AGE());
  const started = Date.now();
  for (;;) {
    const left = committed + age - Number((await ctx.provider.getBlock('latest')).timestamp);
    if (left <= 0) break;
    if (Date.now() - started > TX_WAIT_MS * 2) throw new CliError(L('Ochranná lhůta neuplynula ani po šesti minutách. Těží někdo? Závazek platí den, registraci spusťte znovu.', 'The protection period has not passed after six minutes. Is anyone mining? Start the registration again.'));
    if (!ctx.opts.json) process.stderr.write(`\r${L(`Ochranná lhůta, ještě asi ${left} s…`, `Protection period, about ${left} s left…`)}   `);
    await new Promise((r) => { setTimeout(r, NAME_WAIT_POLL_MS); });
  }
  if (!ctx.opts.json) process.stderr.write('\n');
  const result = await submit(ctx, { to: c.target, value: cost, data: encode(c, 'register', [name, years, target, secret]) }, [], { confirmed: true, label: L('Registrace', 'Registration') });
  const expires = eventArg(result, c, 'Registered', 'expires');
  finish(ctx, result, L(`Jméno ${name}.qu je vaše do ${dateText(expires)}. Převod na něj: quinvium send ${name}.qu <částka>`, `The name ${name}.qu is yours until ${dateText(expires)}. Send to it with: quinvium send ${name}.qu <amount>`), { name, target, expires });
}

const nameAction = (fn, args, lines, done) => async (ctx, rest) => {
  const name = cleanName(rest[0]);
  await ctx.connect();
  const c = ctx.at('AetherNames');
  const [owner] = await c.info(name);
  if (owner === ethers.ZeroAddress) throw new CliError(L(`Jméno ${name}.qu nikdo nevlastní.`, `Nobody owns the name ${name}.qu.`));
  const values = await args(ctx, name, rest.slice(1), c);
  finish(ctx, await submit(ctx, { to: c.target, ...values.tx, data: encode(c, fn, values.args) }, lines(ctx, name, values)), done(name, values));
};

const nameCommand = {
  name: 'name',
  usage: () => L(`Jména adres: místo dlouhé adresy krátké jméno, třeba alice.qu. Cena se pálí a platí se na roky.

  quinvium name info <jméno>                 volné nebo obsazené, vlastník, cíl, platnost
  quinvium name of <adresa>                  hlavní jméno adresy
  quinvium name register <jméno> [--target 0x…] [--years 1]   asi minuta, dva podpisy
  quinvium name renew <jméno> [--years 1]
  quinvium name primary <jméno>              ukazovat jméno místo vaší adresy
  quinvium name target <jméno> <adresa>      změna cílové adresy
  quinvium name transfer <jméno> <adresa>    nový vlastník přebírá jméno i správu`, `Names: a short name such as alice.qu instead of a long address. The price is burned and paid per year.

  quinvium name info <name>                  available or taken, owner, target, expiry
  quinvium name of <address>                 the primary name of an address
  quinvium name register <name> [--target 0x…] [--years 1]     about a minute, two signatures
  quinvium name renew <name> [--years 1]
  quinvium name primary <name>               show the name instead of your address
  quinvium name target <name> <address>      change the target address
  quinvium name transfer <name> <address>    the new owner takes over the name`),
  async info(ctx, [text]) {
    const name = cleanName(text);
    await ctx.connect();
    const c = ctx.at('AetherNames');
    if (!(await c.valid(name))) throw new CliError(L(`Neplatné jméno ${name}. Povolena jsou malá písmena, číslice a pomlčka, 3 až 32 znaků.`, `Invalid name ${name}: 3 to 32 lowercase letters, digits or hyphens.`));
    const price = await c.pricePerYear(name);
    if (await c.available(name)) {
      ctx.print({ name, available: true, pricePerYear: price }, pairs([[L('Jméno', 'Name'), `${name}.qu`], [L('Stav', 'Status'), L('volné', 'available')], [L('Cena za rok', 'Price per year'), `${units(price)} ${ctx.symbol}`], [L('Registrace', 'Register'), `quinvium name register ${name}`]]));
      return;
    }
    const [owner, target, expires] = await c.info(name);
    ctx.print({ name, available: false, owner, target, expires, pricePerYear: price }, pairs([[L('Jméno', 'Name'), `${name}.qu`], [L('Stav', 'Status'), Number(expires) > now() ? L('obsazené', 'taken') : L('vypršelo, ještě 30 dní ho může prodloužit jen vlastník', 'expired, only the owner can renew it for 30 more days')],
      [L('Vlastník', 'Owner'), owner], [L('Ukazuje na', 'Points to'), target], [L('Platí do', 'Valid until'), dateText(expires)]]));
  },
  async of(ctx, [text]) {
    await ctx.connect();
    const who = await ctx.address(text ?? walletAddress(ctx));
    const name = await ctx.at('AetherNames').nameOf(who);
    ctx.print({ address: who, name: name || null }, name ? `${name}.qu` : L('Tato adresa nemá hlavní jméno.', 'This address has no primary name.'));
  },
  register: registerName,
  renew: nameAction('renew', async (ctx, name, _, c) => {
    const years = yearsOf(ctx);
    return { years, args: [name, years], tx: { value: (await c.pricePerYear(name)) * years } };
  }, (ctx, name, v) => [[L('Prodloužit', 'Renew'), `${name}.qu`], [L('O', 'By'), L(`${v.years} ${v.years === 1n ? 'rok' : v.years < 5n ? 'roky' : 'let'}`, `${v.years} year${v.years === 1n ? '' : 's'}`)], [L('Cena', 'Price'), `${units(v.tx.value)} ${ctx.symbol}`]],
  (name) => L(`Jméno ${name}.qu je prodloužené.`, `The name ${name}.qu is renewed.`)),
  primary: nameAction('setPrimary', async (ctx, name) => ({ args: [name] }), (ctx, name) => [[L('Hlavní jméno', 'Primary name'), `${name}.qu`]],
    (name) => L(`Hlavní jméno je ${name}.qu.`, `The primary name is ${name}.qu.`)),
  target: nameAction('setTarget', async (ctx, name, [to]) => {
    const target = await ctx.address(need(to, 'cílová adresa', 'the target address'));
    return { to: target, args: [name, target] };
  },
    (ctx, name, v) => [[L('Jméno', 'Name'), `${name}.qu`], [L('Nově ukazuje na', 'New target'), v.to]], (name) => L(`Jméno ${name}.qu ukazuje na novou adresu.`, `The name ${name}.qu points to the new address.`)),
  transfer: nameAction('transfer', async (ctx, name, [to]) => {
    const owner = await ctx.address(need(to, 'nový vlastník', 'the new owner'));
    return { to: owner, args: [name, owner] };
  },
    (ctx, name, v) => [[L('Převést jméno', 'Transfer name'), `${name}.qu`], [L('Nový vlastník', 'New owner'), v.to], [L('Pozor', 'Note'), L('nový vlastník přebírá jméno i jeho správu', 'the new owner takes over the name and its management')]],
    (name) => L(`Jméno ${name}.qu má nového vlastníka.`, `The name ${name}.qu has a new owner.`)),
};

// ------------------------------------------------------------------- vlastní token (doplňuje quinvium token <symbol>)
export const tokenApp = {
  async create(ctx, [name, symbol, amount]) {
    need(name, 'název tokenu', 'the token name');
    need(symbol, 'zkratka tokenu', 'the token symbol');
    const supply = parseAmount(need(amount, 'počet tokenů', 'the supply'), 18);
    await ctx.connect();
    const c = ctx.at('TokenFactory');
    const result = await submit(ctx, { to: c.target, data: encode(c, 'create', [name, symbol, 18, supply, false]) },
      [[L('Nový token', 'New token'), `${name} (${symbol})`], [L('Počet', 'Supply'), `${units(supply)}, ${L('všechny dostane vaše adresa, další vyrazit nejde', 'all go to your address, no more can be minted')}`]]);
    const token = eventArg(result, c, 'TokenCreated', 'token');
    finish(ctx, result, L(`Token je na adrese ${token}.\nPosílá se: quinvium send <adresa> <částka> --token ${token}\nZkratka nic nedokazuje, ostatní ho uvidí jako neověřený.`, `The token is at ${token}.\nSend it with: quinvium send <address> <amount> --token ${token}\nThe symbol proves nothing, others see it as unverified.`), { token });
  },
  async created(ctx, [who]) {
    await ctx.connect();
    const creator = who ? await ctx.address(who) : walletAddress(ctx);
    const list = await ctx.at('TokenFactory').tokensOf(creator);
    const rows = await Promise.all([...list].map(async (address) => {
      const t = ctx.at('AetherToken', address);
      const [symbol, name, supply] = await Promise.all([t.symbol(), t.name(), t.totalSupply()]);
      return { address, symbol, name, supply };
    }));
    ctx.print(rows, rows.length ? table([L('Zkratka', 'Symbol'), L('Název', 'Name'), L('Počet', 'Supply'), L('Adresa', 'Address')], rows.map((r) => [r.symbol, r.name, units(r.supply, 18, 4), r.address]), [2]) : L('Tato adresa zatím žádný token nevytvořila.', 'This address has not created any token yet.'));
  },
};

// ------------------------------------------------------------------- sbírka NFT
const nft = {
  name: 'nft',
  usage: () => L(`Sbírka NFT: jedinečné položky, třeba vstupenky, záruční listy nebo díla. Razit smí jen tvůrce sbírky.

  quinvium nft create <název> <zkratka>              nová sbírka
  quinvium nft mint <sbírka> <příjemce> <odkaz>      vyrazí položku, odkaz vede na její popis (ipfs://…)
  quinvium nft show <sbírka> [číslo položky]
  quinvium nft send <sbírka> <číslo položky> <příjemce>
  quinvium nft created [adresa]                      sbírky, které adresa vytvořila`, `NFT collection: unique items such as tickets, warranties or artworks. Only the creator of a collection can mint.

  quinvium nft create <name> <symbol>                new collection
  quinvium nft mint <collection> <recipient> <link>  mints an item, the link points to its description (ipfs://…)
  quinvium nft show <collection> [item number]
  quinvium nft send <collection> <item number> <recipient>
  quinvium nft created [address]                     collections created by the address`),
  async create(ctx, [name, symbol]) {
    need(name, 'název sbírky', 'the collection name');
    need(symbol, 'zkratka sbírky', 'the collection symbol');
    await ctx.connect();
    const c = ctx.at('CollectionFactory');
    const result = await submit(ctx, { to: c.target, data: encode(c, 'create', [name, symbol]) }, [[L('Nová sbírka', 'New collection'), `${name} (${symbol})`]]);
    const collection = eventArg(result, c, 'CollectionCreated', 'collection');
    finish(ctx, result, L(`Sbírka je na adrese ${collection}. Položku vyrazí: quinvium nft mint ${collection} <příjemce> <odkaz>`, `The collection is at ${collection}. Mint an item with: quinvium nft mint ${collection} <recipient> <link>`), { collection });
  },
  async mint(ctx, [address, to, uri]) {
    const collection = await ctx.address(need(address, 'adresa sbírky', 'the collection address'));
    const target = await ctx.address(need(to, 'příjemce', 'the recipient'));
    need(uri, 'odkaz na popis položky', 'the item metadata link');
    await ctx.connect();
    const c = ctx.at('AetherCollection', collection);
    if (!sameOwner(await c.owner(), walletAddress(ctx))) throw new CliError(L('Razit smí jen tvůrce sbírky.', 'Only the creator of the collection can mint.'));
    const result = await submit(ctx, { to: collection, data: encode(c, 'mint', [target, uri]) }, [[L('Sbírka', 'Collection'), collection], [L('Příjemce', 'Recipient'), target], [L('Odkaz', 'Link'), uri]]);
    const id = eventArg(result, c, 'Transfer', 'tokenId') ?? eventArg(result, c, 'Transfer', 2);
    finish(ctx, result, L(`Položka má číslo ${id}.`, `The item number is ${id}.`), { id });
  },
  async show(ctx, [address, idText]) {
    const collection = await ctx.address(need(address, 'adresa sbírky', 'the collection address'));
    await ctx.connect();
    const c = ctx.at('AetherCollection', collection);
    const [name, symbol, minted, owner] = await Promise.all([c.name(), c.symbol(), c.totalMinted(), c.owner()]).catch(() => { throw new CliError(L(`Na adrese ${collection} není sbírka NFT.`, `There is no NFT collection at ${collection}.`)); });
    const rows = [[L('Sbírka', 'Collection'), `${name} (${symbol})`], [L('Adresa', 'Address'), collection], [L('Tvůrce', 'Creator'), owner], [L('Vyraženo položek', 'Items minted'), minted]];
    const data = { collection, name, symbol, minted, creator: owner };
    if (idText !== undefined) {
      const id = parseId(idText, ID.nft);
      const [holder, uri] = await Promise.all([c.ownerOf(id), c.tokenURI(id)]).catch(() => { throw new CliError(L(`Položka ${id} ve sbírce neexistuje.`, `Item ${id} does not exist in the collection.`)); });
      rows.push([L('Položka', 'Item'), id], [L('Vlastník', 'Owner'), holder], [L('Odkaz', 'Link'), uri]);
      Object.assign(data, { id, owner: holder, uri });
    }
    ctx.print(data, pairs(rows));
  },
  async send(ctx, [address, idText, to]) {
    const collection = await ctx.address(need(address, 'adresa sbírky', 'the collection address'));
    const id = parseId(idText, ID.nft);
    const target = await ctx.address(need(to, 'příjemce', 'the recipient'));
    await ctx.connect();
    const c = ctx.at('AetherCollection', collection);
    const me = walletAddress(ctx);
    if (!sameOwner(await c.ownerOf(id).catch(() => ethers.ZeroAddress), me)) throw new CliError(L(`Položku ${id} nevlastníte.`, `You do not own item ${id}.`));
    // Bezpečný převod: kontrakt, který NFT neumí přijmout, převod odmítne, položka se tak neztratí.
    finish(ctx, await submit(ctx, { to: collection, data: encode(c, 'safeTransferFrom(address,address,uint256)', [me, target, id]) }, [[L('Položka', 'Item'), `${id}, ${collection}`], [L('Příjemce', 'Recipient'), target]]), L('Položka je odeslaná.', 'The item is sent.'));
  },
  async created(ctx, [who]) {
    await ctx.connect();
    const creator = who ? await ctx.address(who) : walletAddress(ctx);
    const list = await ctx.at('CollectionFactory').collectionsOf(creator);
    const rows = await Promise.all([...list].map(async (address) => {
      const c = ctx.at('AetherCollection', address);
      const [name, symbol, minted] = await Promise.all([c.name(), c.symbol(), c.totalMinted()]);
      return { address, name, symbol, minted };
    }));
    ctx.print(rows, rows.length ? table([L('Zkratka', 'Symbol'), L('Název', 'Name'), L('Položek', 'Items'), L('Adresa', 'Address')], rows.map((r) => [r.symbol, r.name, r.minted, r.address]), [2]) : L('Tato adresa zatím žádnou sbírku nevytvořila.', 'This address has not created any collection yet.'));
  },
};
const sameOwner = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// ------------------------------------------------------------------- peněženka s více podpisy
async function walletContract(ctx, text) {
  const address = await ctx.address(need(text, 'adresa peněženky', 'the wallet address'));
  await ctx.connect();
  const c = ctx.at('Multisig', address);
  const owners = await c.getOwners().catch(() => { throw new CliError(L(`Na adrese ${address} není peněženka s více podpisy.`, `There is no multisig wallet at ${address}.`)); });
  return { c, address, owners: [...owners] };
}
const multisigAction = (fn, label, done) => async (ctx, [walletText, idText]) => {
  const { c, address, owners } = await walletContract(ctx, walletText);
  const id = parseId(idText, ID.proposal);
  if (!owners.some((o) => sameOwner(o, walletAddress(ctx)))) throw new CliError(L('Nejste majitel této peněženky.', 'You are not an owner of this wallet.'));
  finish(ctx, await submit(ctx, { to: address, data: encode(c, fn, [id]) }, [[label(), `${id}, ${L('peněženka', 'wallet')} ${address}`]]), done(id));
};

const multisig = {
  name: 'multisig',
  usage: () => L(`Peněženka s více podpisy: platba odejde až po schválení více majiteli. Dobije se běžnou platbou: quinvium send <peněženka> <částka>

  quinvium multisig create <adresa,adresa,…> <počet podpisů>
  quinvium multisig show <peněženka> [číslo návrhu]
  quinvium multisig propose <peněženka> <příjemce> <částka>   váš podpis se připíše hned
  quinvium multisig approve <peněženka> <číslo návrhu>
  quinvium multisig revoke <peněženka> <číslo návrhu>         stáhne vaše schválení
  quinvium multisig execute <peněženka> <číslo návrhu>        platba odejde, když má dost schválení
  quinvium multisig list [adresa]                             peněženky, kde je adresa majitelem`, `Multisig wallet: a payment leaves only after several owners approve it. Fund it with a normal payment: quinvium send <wallet> <amount>

  quinvium multisig create <address,address,…> <required signatures>
  quinvium multisig show <wallet> [proposal number]
  quinvium multisig propose <wallet> <payee> <amount>         your approval is added right away
  quinvium multisig approve <wallet> <proposal number>
  quinvium multisig revoke <wallet> <proposal number>         withdraws your approval
  quinvium multisig execute <wallet> <proposal number>        pays out once there are enough approvals
  quinvium multisig list [address]                            wallets the address owns`),
  async create(ctx, [ownersText, thresholdText]) {
    const owners = await Promise.all(String(need(ownersText, 'adresy majitelů oddělené čárkou', 'the owner addresses separated by commas')).split(',').map((x) => x.trim()).filter(Boolean).map((x) => ctx.address(x)));
    const threshold = parseId(thresholdText, { cs: 'počet potřebných podpisů', en: 'number of required signatures' });
    if (new Set(owners.map((o) => o.toLowerCase())).size !== owners.length) throw new CliError(L('Každý majitel smí být v seznamu jen jednou.', 'Each owner can be listed only once.'));
    if (threshold < 1n || threshold > BigInt(owners.length)) throw new CliError(L(`Počet podpisů musí být 1 až ${owners.length}.`, `The number of signatures must be 1 to ${owners.length}.`));
    await ctx.connect();
    const c = ctx.at('MultisigFactory');
    const mine = owners.some((o) => sameOwner(o, walletAddress(ctx)));
    const result = await submit(ctx, { to: c.target, data: encode(c, 'create', [owners, threshold]) }, [[L('Majitelé', 'Owners'), owners.join(', ')], [L('Potřebné podpisy', 'Required signatures'), `${threshold} / ${owners.length}`],
      mine ? null : [L('Pozor', 'Note'), L('vaše adresa mezi majiteli není, s peněženkou pak nic neuděláte', 'your address is not among the owners, you will not be able to use the wallet')]]);
    const wallet = eventArg(result, c, 'WalletCreated', 'wallet');
    finish(ctx, result, L(`Peněženka je na adrese ${wallet}. Dobijete ji: quinvium send ${wallet} <částka>`, `The wallet is at ${wallet}. Fund it with: quinvium send ${wallet} <amount>`), { wallet });
  },
  async show(ctx, [walletText, idText]) {
    const { c, address, owners } = await walletContract(ctx, walletText);
    const [threshold, total, balance] = await Promise.all([c.threshold(), c.proposalCount(), ctx.provider.getBalance(address)]);
    const rows = [[L('Peněženka', 'Wallet'), address], [L('Majitelé', 'Owners'), owners.join(', ')], [L('Potřebné podpisy', 'Required signatures'), `${threshold} / ${owners.length}`], [L('Zůstatek', 'Balance'), `${units(balance)} ${ctx.symbol}`], [L('Návrhů', 'Proposals'), total]];
    const data = { wallet: address, owners, threshold, proposals: total, balance };
    if (idText !== undefined) {
      const id = parseId(idText, ID.proposal);
      if (id >= total) throw new CliError(L(`Návrh ${id} neexistuje, peněženka má ${total} návrhů.`, `Proposal ${id} does not exist, the wallet has ${total} proposals.`));
      const [p, approvals] = await Promise.all([c.getProposal(id), c.confirmationCount(id)]);
      rows.push([L('Návrh', 'Proposal'), id], [L('Stav návrhu', 'Proposal status'), p.executed ? L('provedeno', 'executed') : L('čeká na schválení', 'awaiting approval')], [L('Příjemce', 'Payee'), p.to], [L('Částka', 'Amount'), `${units(p.value)} ${ctx.symbol}`], [L('Schválení', 'Approvals'), `${approvals} / ${threshold}`]);
      Object.assign(data, { id, to: p.to, value: p.value, executed: p.executed, approvals });
    }
    ctx.print(data, pairs(rows));
  },
  async propose(ctx, [walletText, to, amountText]) {
    const { c, address, owners } = await walletContract(ctx, walletText);
    const payee = await ctx.address(need(to, 'příjemce platby', 'the payee'));
    const value = parseAmount(need(amountText, 'částka', 'the amount'));
    if (!owners.some((o) => sameOwner(o, walletAddress(ctx)))) throw new CliError(L('Navrhovat smí jen majitel peněženky.', 'Only an owner of the wallet can propose.'));
    const result = await submit(ctx, { to: address, data: encode(c, 'submit', [payee, value, '0x']) }, [[L('Návrh platby z peněženky', 'Payment proposal from wallet'), address], [L('Příjemce', 'Payee'), payee], [L('Částka', 'Amount'), `${units(value)} ${ctx.symbol}`]]);
    const id = eventArg(result, c, 'Submitted', 'id');
    finish(ctx, result, L(`Návrh má číslo ${id}. Ostatní majitelé ho schválí: quinvium multisig approve ${address} ${id}`, `The proposal number is ${id}. The other owners approve it with: quinvium multisig approve ${address} ${id}`), { id });
  },
  approve: multisigAction('confirm', () => L('Schválit návrh', 'Approve proposal'), (id) => L(`Návrh ${id} je schválený.`, `Proposal ${id} is approved.`)),
  revoke: multisigAction('revoke', () => L('Stáhnout schválení návrhu', 'Withdraw approval of proposal'), (id) => L(`Schválení návrhu ${id} je stažené.`, `The approval of proposal ${id} is withdrawn.`)),
  execute: multisigAction('execute', () => L('Provést návrh', 'Execute proposal'), (id) => L(`Návrh ${id} je provedený, platba odešla.`, `Proposal ${id} is executed, the payment has left.`)),
  async list(ctx, [who]) {
    await ctx.connect();
    const owner = who ? await ctx.address(who) : walletAddress(ctx);
    const list = [...await ctx.at('MultisigFactory').walletsOf(owner)];
    const rows = await Promise.all(list.map(async (address) => {
      const c = ctx.at('Multisig', address);
      const [owners, threshold, balance] = await Promise.all([c.getOwners(), c.threshold(), ctx.provider.getBalance(address)]);
      return { address, owners: owners.length, threshold, balance };
    }));
    ctx.print(rows, rows.length ? table([L('Peněženka', 'Wallet'), L('Podpisy', 'Signatures'), L('Zůstatek', 'Balance')], rows.map((r) => [r.address, `${r.threshold} / ${r.owners}`, `${units(r.balance, 18, 4)} ${ctx.symbol}`]), [1, 2]) : L('Tato adresa není majitelem žádné peněženky s více podpisy.', 'This address owns no multisig wallet.'));
  },
};

/** Spuštění podúkolu aplikace. Bez podúkolu, s help nebo --help se ukáže nápověda aplikace. */
const appCommand = (app) => {
  const run = async (ctx, [sub, ...rest]) => {
    const fn = app[sub];
    if (!sub || sub === 'help' || ctx.opts.help || typeof fn !== 'function' || sub === 'usage') { usageOf(app, typeof fn === 'function' && sub !== 'usage' ? undefined : sub); return; }
    await fn(ctx, rest);
  };
  run.usage = app.usage;
  return run;
};

export const APPS = { notary, credential, supply, escrow, poll, name: nameCommand, nft, multisig };
export const appCommands = Object.fromEntries(Object.entries(APPS).map(([key, app]) => [key, appCommand(app)]));
