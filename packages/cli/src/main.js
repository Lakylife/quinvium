// Quinvium command line. Everything the app can do also works without a window, as with Bitcoin and Ethereum.
import { parseArgs } from 'node:util';
import pkg from '../package.json' with { type: 'json' };
import { APPS, appCommands } from './apps.js';
import { audit } from './audit.js';
import { bridge } from './bridge.js';
import { address, block, gas, mempool, miners, peers, rawRpc, rich, search, sign, status, tx, verify } from './chain.js';
import { CliError, Context, DEFAULT_NETWORK, reason } from './context.js';
import { L, LANGUAGES, chooseLanguage, lang, languageOf, saveLanguage, savedLanguage } from './i18n.js';
import { mine } from './mine.js';
import { balance, liquidity, send, swap, token, tokens } from './money.js';
import { NETWORKS } from '../../node/src/params.js';
import { pool } from './pool.js';
import { login, walletCommand } from './wallets.js';

const help = () => L(`Quinvium ${pkg.version}, příkazová řádka

Použití: quinvium <příkaz> [volby]

Síť
  status                         stav sítě a uzlu
  search <cokoli>                hledání: blok, transakce, adresa, jméno .qu, token
  block [číslo|hash]             blok, bez čísla poslední
  tx <hash>                      transakce, metoda a u neúspěšné důvod
  address [adresa]               přehled adresy
  gas                            aktuální poplatky
  peers, mempool, miners, rich   uzly, čekající transakce, těžaři, žebříček
  rpc <metoda> [parametry]       přímý dotaz na uzel

Peněženka
  login [název]                  se kterou peněženkou pracujete, výběr jiné
  wallet create [název]          nová peněženka s frází pro obnovu
  wallet import [název]          obnova z fráze
  wallet import-app [název]      stejná peněženka jako v aplikaci, jen heslem
  wallet import-key [název]      peněženka ze soukromého klíče
  wallet list | show | default   seznam, detail, výběr výchozí
  wallet phrase | key            zobrazí frázi nebo klíč
  wallet password | remove       změna hesla, smazání z počítače
  balance [adresa]               zůstatky mince a tokenů
  send <adresa|jméno.qu> <částka>   převod, s --token token
  sign <text>, verify <text> <podpis> [adresa]

Tokeny a Swap
  tokens, token <symbol|adresa>  ověřené tokeny, detail tokenu
  token create | created         vlastní token, tokeny vytvořené adresou
  swap quote <částka> <z> <na>   kurz bez odeslání
  swap <částka> <z> <na>         směna
  swap pools                     pooly a jejich zásoby
  liquidity add <č> <t> <č> <t>  vklad do poolu
  liquidity remove <t> <t>       výběr z poolu, --percent část
  liquidity list                 moje podíly

Aplikace (bez podpříkazu ukážou nápovědu)
  notary                         otisk dokumentu: zápis, ověření, odvolání
  credential                     diplomy a licence: vydavatel, vydání, ověření
  supply                         dodavatelský řetězec: položky, kroky, předání
  escrow                         úschova plateb s rozhodcem
  poll                           veřejné hlasování
  name                           jména adres .qu: registrace, prodloužení, převod
  nft                            sbírky NFT: založení, ražba, převod
  multisig                       peněženka s více podpisy

Most
  bridge routes                  trasy a stav mostu
  bridge out <částka> <mince> [příjemce]    z Quinvia na jinou síť
  bridge in <částka> <mince> [příjemce]     z jiné sítě na Quinvium
  bridge deposit-btc [příjemce]  vkladová adresa pro Bitcoin
  bridge status [adresa]         moje převody

Těžba a uzel
  mine                           těží na výchozí peněženku
    --address <0x…>  --intensity <10-100>  --device <N|all>  --pool <0x…>  --list
  pool list | info <adresa>      pooly
  pool claim <adresa>            výběr výdělku z poolu
  pool create --name <n> --url <u> [--fee-percent 1]
  pool withdraw-fee <adresa>     výběr poplatku provozovatele
  node [volby quintium-node]     spustí plný uzel, viz quinvium node --help
  audit [--data-dir <složka>] [--quick]     znovu provede celý řetězec od genesis a sečte mince

Volby pro všechny příkazy
  -n, --network <mainnet|testnet|dev>   síť, výchozí ${DEFAULT_NETWORK}
  --rpc <url>            uzel, výchozí místní uzel zvolené sítě
  -w, --wallet <název>   peněženka, výchozí ta označená hvězdičkou
  --json                 výstup pro skripty
  -y, --yes              bez potvrzení, pro skripty
  --password-file <soubor>   heslo ze souboru, ne z klávesnice
  --fee <slow|normal|fast>   rychlost transakce
  --no-wait              nečekat na blok
  --slippage <procenta>  tolerance skluzu, výchozí 0,5
  --lang <en|cs>         jazyk výpisu, trvale ho nastaví: quinvium lang cs
  -v, --version          verze

Peněženky jsou šifrované soubory ve složce ~/.aether/wallets. Heslo, frázi ani klíč nikdy nepište přímo do příkazu.
`, `Quinvium ${pkg.version}, command line

Usage: quinvium <command> [options]

Network
  status                         network and node status
  search <anything>              search: block, transaction, address, .qu name, token
  block [number|hash]            a block, the latest without a number
  tx <hash>                      a transaction, its method and why it failed
  address [address]              address overview
  gas                            current fees
  peers, mempool, miners, rich   peers, pending transactions, miners, rich list
  rpc <method> [params]          direct node call

Wallet
  login [name]                   which wallet you work with, choose another
  wallet create [name]           new wallet with a recovery phrase
  wallet import [name]           restore from a phrase
  wallet import-app [name]       the same wallet as in the app, with its password
  wallet import-key [name]       wallet from a private key
  wallet list | show | default   list, details, choose the default
  wallet phrase | key            show the phrase or the key
  wallet password | remove       change the password, delete from this computer
  balance [address]              coin and token balances
  send <address|name.qu> <amount>   transfer, with --token for a token
  sign <text>, verify <text> <signature> [address]

Tokens and Swap
  tokens, token <symbol|address>  verified tokens, token details
  token create | created         your own token, tokens created by an address
  swap quote <amount> <from> <to>   quote without sending
  swap <amount> <from> <to>      swap
  swap pools                     pools and their reserves
  liquidity add <a> <t> <a> <t>  add to a pool
  liquidity remove <t> <t>       withdraw from a pool, --percent for a part
  liquidity list                 my pool shares

Apps (without a subcommand they show their help)
  notary                         document fingerprints: record, verify, revoke
  credential                     diplomas and licences: issuer, issue, verify
  supply                         supply chain: items, steps, handovers
  escrow                         escrow payments with an arbiter
  poll                           public voting
  name                           .qu names: register, renew, transfer
  nft                            NFT collections: create, mint, send
  multisig                       multisig wallet

Bridge
  bridge routes                  routes and bridge status
  bridge out <amount> <coin> [recipient]    from Quinvium to another network
  bridge in <amount> <coin> [recipient]     from another network to Quinvium
  bridge deposit-btc [recipient] deposit address for Bitcoin
  bridge status [address]        my transfers

Mining and node
  mine                           mines to the default wallet
    --address <0x…>  --intensity <10-100>  --device <N|all>  --pool <0x…>  --list
  pool list | info <address>     pools
  pool claim <address>           claim pool earnings
  pool create --name <n> --url <u> [--fee-percent 1]
  pool withdraw-fee <address>    withdraw the operator fee
  node [quintium-node options]   runs a full node, see quinvium node --help
  audit [--data-dir <folder>] [--quick]     replays the whole chain from genesis and counts the coins

Options for all commands
  -n, --network <mainnet|testnet|dev>   network, default ${DEFAULT_NETWORK}
  --rpc <url>            node, default the local node of the network
  -w, --wallet <name>    wallet, default the one marked with a star
  --json                 output for scripts
  -y, --yes              no confirmation, for scripts
  --password-file <file> password from a file, not the keyboard
  --fee <slow|normal|fast>   transaction speed
  --no-wait              do not wait for a block
  --slippage <percent>   slippage tolerance, default 0.5
  --lang <en|cs>         output language, set it for good with: quinvium lang cs
  -v, --version          version

Wallets are encrypted files in ~/.aether/wallets. Never type a password, phrase or key into the command itself.
`);

const OPTIONS = {
  network: { type: 'string', short: 'n' }, rpc: { type: 'string' }, wallet: { type: 'string', short: 'w' }, json: { type: 'boolean' }, yes: { type: 'boolean', short: 'y' },
  'password-file': { type: 'string' }, deployments: { type: 'string' }, token: { type: 'string' }, fee: { type: 'string' }, slippage: { type: 'string' }, percent: { type: 'string' },
  name: { type: 'string' }, url: { type: 'string' }, index: { type: 'string' }, 'phrase-file': { type: 'string' }, 'key-file': { type: 'string' }, 'show-secret': { type: 'boolean' },
  'no-wait': { type: 'boolean' }, address: { type: 'string' }, pool: { type: 'string' }, server: { type: 'string' }, intensity: { type: 'string' }, device: { type: 'string' }, worker: { type: 'string' }, backend: { type: 'string' }, list: { type: 'boolean' },
  'data-dir': { type: 'string' }, quick: { type: 'boolean' }, 'fee-percent': { type: 'string' }, round: { type: 'string' }, window: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
  lang: { type: 'string' }, text: { type: 'string' }, note: { type: 'string' }, author: { type: 'string' }, reason: { type: 'string' }, website: { type: 'string' }, type: { type: 'string' },
  days: { type: 'string' }, years: { type: 'string' }, target: { type: 'string' }, evidence: { type: 'string' },
};

/** quinvium lang: shows the language; quinvium lang cs saves it for later runs. */
async function language(ctx, [choice]) {
  if (!choice) {
    ctx.print({ lang: lang(), saved: savedLanguage() }, L(`Jazyk: čeština. Změní ho: quinvium lang en`, 'Language: English. Change it with: quinvium lang cs'));
    return;
  }
  const picked = languageOf(choice);
  if (!picked) throw new CliError(L(`Neznámý jazyk ${choice}, zvolte ${LANGUAGES.join(' nebo ')}.`, `Unknown language ${choice}, choose ${LANGUAGES.join(' or ')}.`));
  saveLanguage(picked);
  chooseLanguage(picked);
  ctx.print({ lang: picked }, L('Jazyk je čeština.', 'The language is English.'));
}

const COMMANDS = {
  status, search, block, tx, address, gas, peers, mempool, miners, rich, rpc: rawRpc, sign, verify, audit, balance, send, tokens, token, swap, liquidity, bridge, pool, mine, wallet: walletCommand, login,
  ...appCommands, credentials: appCommands.credential, polls: appCommands.poll, names: appCommands.name, lang: language,
};

const optionOf = (args, name) => {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  return args[i].includes('=') ? args[i].slice(name.length + 1) : args[i + 1];
};
/** --lang belongs to the tool; the node would reject it as an unknown option. */
const withoutLang = (args) => args.filter((a, i) => !(a === '--lang' || a.startsWith('--lang=') || (args[i - 1] === '--lang' && !a.startsWith('-'))));

/** A node already running on the port (for example in the app) answers web3_clientVersion. */
const runningNode = (port) => fetch(`http://127.0.0.1:${port}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'web3_clientVersion', params: [] }), signal: AbortSignal.timeout(2000),
}).then((r) => r.json()).then((b) => b.result ?? null).catch(() => null);

/** The full node runs in this process. One file in the package is enough for everything. */
async function runNode(all) {
  const args = withoutLang(all);
  const hasNetwork = args.some((a) => a === '--network' || a.startsWith('--network='));
  const network = optionOf(args, '--network') ?? DEFAULT_NETWORK;
  // A second node on the same ports would fail with EADDRINUSE. The running node is enough for the other commands.
  if (!args.includes('--help') && !args.includes('-h') && NETWORKS[network]) {
    const port = optionOf(args, '--rpc-port') ?? NETWORKS[network].ports.rpc;
    const version = await runningNode(port);
    if (version) {
      const second = `  quinvium node --network ${network} --rpc-port 8600 --p2p-port 30600 --stratum-port 3400 --data-dir ~/.aether/${L('druhy-uzel', 'second-node')}`;
      console.error(L(`Na tomto počítači už běží uzel sítě ${network}: http://127.0.0.1:${port} (${version}), nejspíš v aplikaci Quinvium.
Ostatní příkazy ho použijí samy, například: quinvium status
Druhý uzel vedle něj potřebuje vlastní porty a složku:
${second}`, `A ${network} node already runs on this computer: http://127.0.0.1:${port} (${version}), probably in the Quinvium app.
The other commands use it by themselves, for example: quinvium status
A second node next to it needs its own ports and folder:
${second}`));
      process.exitCode = 1;
      return;
    }
  }
  process.argv = [process.argv[0], process.argv[1], ...(hasNetwork ? [] : ['--network', DEFAULT_NETWORK]), ...args];
  await import('../../node/src/cli.js');
}

/** parseArgs messages are in English and long. The user needs to know which option the tool does not recognise. */
function parseError(e) {
  const option = /'([^']+)'/.exec(e.message)?.[1];
  if (e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && option) return L(`Neznámá volba ${option}. Přehled zobrazí: quinvium --help`, `Unknown option ${option}. See: quinvium --help`);
  if (e.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' && option) return L(`Volba ${option.split(' ')[0]} potřebuje hodnotu.`, `The option ${option.split(' ')[0]} needs a value.`);
  return e.message;
}

export async function run(args) {
  chooseLanguage(optionOf(args, '--lang'));
  if (args[0] === 'node') { await runNode(args.slice(1)); return; }
  let ctx;
  try {
    const { values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true });
    if (values.version) { console.log(pkg.version); return; }
    const [name, ...rest] = positionals;
    if (!name || name === 'help') {
      const topic = rest[0] && (APPS[rest[0]] ?? (rest[0] === 'token' ? token : null));
      console.log(topic?.usage ? topic.usage() : help());
      return;
    }
    const command = COMMANDS[name];
    if (!command) throw new CliError(L(`Neznámý příkaz ${name}. Přehled zobrazí: quinvium --help`, `Unknown command ${name}. See: quinvium --help`));
    if (values.help && !command.usage) { console.log(help()); return; }
    ctx = new Context(values);
    await command(ctx, rest);
  } catch (e) {
    const text = e instanceof CliError ? e.message : e.code?.startsWith?.('ERR_PARSE_ARGS') ? parseError(e) : reason(e);
    console.error(`${L('Chyba', 'Error')}: ${text}`);
    if (process.env.AETHER_DEBUG) console.error(e);
    process.exitCode = 1;
  } finally {
    ctx?.provider?.destroy();
  }
}
