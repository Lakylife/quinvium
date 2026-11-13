// Peněženky v šifrovaných souborech, stejný formát jako geth (keystore V3). Klíč se dešifruje jen na dobu podpisu.
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ethers } from 'ethers';
import { CliError, ask, askHidden, pairs, table, yesNo } from './context.js';
import { L } from './i18n.js';

const MIN_PASSWORD = 10;
const NAME = /^[\w.-]{1,40}$/;
const HD_PATH = "m/44'/60'/0'/0/";   // stejná cesta jako aplikace a MetaMask, fráze dá stejné adresy
const DEFAULT_FILE = '.vychozi';

export const home = () => process.env.AETHER_HOME ?? join(homedir(), '.aether');
const dir = () => join(home(), 'wallets');
const fileOf = (name) => {
  if (!NAME.test(name)) throw new CliError(L('Název peněženky smí mít jen písmena, číslice, tečku, pomlčku a podtržítko.', 'A wallet name may only contain letters, digits, dots, hyphens and underscores.'));
  return join(dir(), `${name}.json`);
};

function ensureDir() {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  chmodSync(dir(), 0o700);
}

/** Zápis přes dočasný soubor: pád uprostřed nesmí poškodit jedinou kopii klíče. */
function writeSafe(path, text) {
  ensureDir();
  writeFileSync(`${path}.tmp`, text, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

const addressOf = (name) => {
  const json = JSON.parse(readFileSync(fileOf(name), 'utf8'));
  return ethers.getAddress(`0x${String(json.address).replace(/^0x/, '')}`);
};

export function listWallets() {
  if (!existsSync(dir())) return [];
  return readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

function defaultName() {
  const list = listWallets();
  const saved = existsSync(join(dir(), DEFAULT_FILE)) ? readFileSync(join(dir(), DEFAULT_FILE), 'utf8').trim() : null;
  if (saved && list.includes(saved)) return saved;
  return list[0] ?? null;
}

const NO_WALLET = () => L('Zatím tu není žádná peněženka. Založte ji příkazem: quinvium wallet create', 'There is no wallet yet. Create one with: quinvium wallet create');

/** Název peněženky pro příkaz. Bez volby se bere výchozí. */
export function chosenWallet(ctx) {
  const name = ctx.opts.wallet ?? defaultName();
  if (!name) throw new CliError(NO_WALLET());
  if (!existsSync(fileOf(name))) throw new CliError(L(`Peněženka ${name} neexistuje. Seznam zobrazí: quinvium wallet list`, `Wallet ${name} does not exist. See the list: quinvium wallet list`));
  return name;
}

export const walletAddress = (ctx) => addressOf(chosenWallet(ctx));

async function password(ctx, prompt) {
  const file = ctx.opts['password-file'];
  if (file) {
    if (process.platform !== 'win32' && (statSync(file).mode & 0o077)) console.error(L(`Pozor: soubor ${file} s heslem mohou číst i jiní uživatelé.`, `Warning: other users can read the password file ${file}.`));
    return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  }
  return askHidden(prompt);
}

async function newPassword(ctx) {
  const first = await password(ctx, L(`Heslo (nejméně ${MIN_PASSWORD} znaků): `, `Password (at least ${MIN_PASSWORD} characters): `));
  if (first.length < MIN_PASSWORD) throw new CliError(L(`Heslo musí mít nejméně ${MIN_PASSWORD} znaků.`, `The password must have at least ${MIN_PASSWORD} characters.`));
  if (!ctx.opts['password-file'] && first !== await askHidden(L('Zopakujte heslo: ', 'Repeat the password: '))) throw new CliError(L('Hesla se neshodují.', 'The passwords do not match.'));
  return first;
}

/** Odemkne peněženku jen pro tento příkaz. */
export async function unlock(ctx) {
  const name = chosenWallet(ctx);
  const json = readFileSync(fileOf(name), 'utf8');
  const secret = await password(ctx, L(`Heslo peněženky ${name}: `, `Password of wallet ${name}: `));
  try {
    return await ethers.Wallet.fromEncryptedJson(json, secret);
  } catch {
    throw new CliError(L('Špatné heslo.', 'Wrong password.'));
  }
}

async function store(ctx, name, wallet, known) {
  const path = fileOf(name);
  if (existsSync(path)) throw new CliError(L(`Peněženka ${name} už existuje. Zvolte jiný název přes --name.`, `Wallet ${name} already exists. Choose another name with --name.`));
  // Peněženka z aplikace si nechá své heslo, pokud je dost dlouhé. Jinak se zeptá na nové.
  const secret = known && known.length >= MIN_PASSWORD ? known : await newPassword(ctx);
  const first = listWallets().length === 0;
  writeSafe(path, await wallet.encrypt(secret));
  if (first) writeSafe(join(dir(), DEFAULT_FILE), name);   // výchozí je první peněženka, ne ta první podle abecedy
  return path;
}

const nameFor = (ctx, rest) => rest[0] ?? ctx.opts.name ?? (listWallets().length ? null : 'hlavni');
function needName(ctx, rest) {
  const name = nameFor(ctx, rest);
  if (!name) throw new CliError(L('Zadejte název nové peněženky, například: quinvium wallet create uspory', 'Give the new wallet a name, for example: quinvium wallet create savings'));
  return name;
}

/** Tajemství se na obrazovku smí dostat jen v terminálu, jinak by skončilo v logu nebo v souboru. */
function showSecret(ctx, title, value) {
  if (!process.stdout.isTTY && !ctx.opts['show-secret']) {
    throw new CliError(L('Výstup nejde do terminálu, tajemství se nevypíše. Pokud to tak opravdu chcete, přidejte --show-secret.', 'The output is not a terminal, so the secret is not printed. If you really want that, add --show-secret.'));
  }
  console.log(`${title}\n\n  ${value}\n`);
}

async function secretInput(ctx, fileOption, prompt) {
  const file = ctx.opts[fileOption];
  return (file ? readFileSync(file, 'utf8') : await askHidden(prompt)).trim();
}

const hdWallet = (phrase, index) => ethers.HDNodeWallet.fromPhrase(phrase, undefined, `${HD_PATH}${index}`);

/** Data aplikace Quinvium. Složka se po přejmenování nezměnila, jmenuje se dál Aether. */
export const appDataDir = () => process.env.AETHER_APP_DATA ?? (process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'Aether')
  : process.platform === 'win32' ? join(process.env.APPDATA ?? homedir(), 'Aether') : join(homedir(), '.config', 'Aether'));

/** Trezor peněženky aplikace: PBKDF2-SHA256 a AES-256-GCM jako WebCrypto v aplikaci, značka ověření je na konci dat. */
function openAppVault(vault, secret) {
  const key = pbkdf2Sync(secret, Buffer.from(vault.salt, 'base64'), vault.iterations, 32, 'sha256');
  const data = Buffer.from(vault.data, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(vault.iv, 'base64'));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
}

/** Účty aplikace ve stejném pořadí jako v ní: nejdřív z fráze, potom importované klíče. */
async function appAccounts(ctx) {
  const file = join(appDataDir(), 'wallet.json');
  let stored;
  try { stored = JSON.parse(readFileSync(file, 'utf8')); } catch {
    throw new CliError(L(`Peněženka aplikace se nenašla (${file}). Založte ji v aplikaci, nebo tady: quinvium wallet create`, `The app wallet was not found (${file}). Create one in the app, or here: quinvium wallet create`));
  }
  if (!stored.vault) {
    if (stored.external?.address) {
      throw new CliError(L(`Aplikace je přihlášená přes ${stored.external.name ?? 'cizí peněženku'} s adresou ${stored.external.address}. Klíč drží ta peněženka, aplikace ho nemá. Stejnou adresu obnovíte z její fráze: quinvium wallet import`,
        `The app is signed in through ${stored.external.name ?? 'another wallet'} with ${stored.external.address}. That wallet holds the key, the app does not. Restore the same address from its phrase: quinvium wallet import`));
    }
    throw new CliError(L('V aplikaci zatím není žádná peněženka. Založte ji v aplikaci, nebo tady: quinvium wallet create', 'There is no wallet in the app yet. Create one in the app, or here: quinvium wallet create'));
  }
  const secret = await password(ctx, L('Heslo peněženky v aplikaci: ', 'Password of the app wallet: '));
  let phrase;
  let keys = [];
  try {
    phrase = openAppVault(stored.vault, secret);
    if (stored.keyVault) keys = JSON.parse(openAppVault(stored.keyVault, secret));
  } catch {
    throw new CliError(L('Špatné heslo peněženky aplikace.', 'Wrong password of the app wallet.'));
  }
  const count = phrase ? Number(stored.accountCount ?? 1) : 0;
  const accounts = [...Array.from({ length: count }, (_, i) => hdWallet(phrase, i)), ...keys.map((k) => new ethers.Wallet(k))];
  return { accounts, selected: Number(stored.selected ?? 0), secret };
}
const summary = (name, address, path) => pairs([[L('Peněženka', 'Wallet'), name], [L('Adresa', 'Address'), address], [L('Soubor', 'File'), path]]);

const COMMANDS = {
  async create(ctx, rest) {
    const name = needName(ctx, rest);
    const phrase = ethers.Mnemonic.fromEntropy(ethers.randomBytes(16)).phrase;
    const wallet = hdWallet(phrase, 0);
    const path = await store(ctx, name, wallet);
    ctx.note(summary(name, wallet.address, path));
    if (ctx.opts.json) { ctx.print({ name, address: wallet.address, path }); return; }
    console.log(L('\nZapište si frázi na papír. Kdo ji zná, ovládá všechny vaše mince. Bez ní se ke ztracené peněžence nikdo nedostane.', '\nWrite the phrase down on paper. Whoever knows it controls all your coins. Without it nobody can recover a lost wallet.'));
    if (process.stdout.isTTY || ctx.opts['show-secret']) showSecret(ctx, L('Fráze pro obnovu:', 'Recovery phrase:'), phrase);
    else console.log(L('Výstup nejde do terminálu, proto se fráze nevypsala. Zobrazí ji: quinvium wallet phrase', 'The output is not a terminal, so the phrase was not printed. Show it with: quinvium wallet phrase'));
  },

  async import(ctx, rest) {
    const name = needName(ctx, rest);
    const phrase = (await secretInput(ctx, 'phrase-file', L('Fráze pro obnovu: ', 'Recovery phrase: '))).toLowerCase().replace(/\s+/g, ' ');
    if (!ethers.Mnemonic.isValidMnemonic(phrase)) throw new CliError(L('Neplatná fráze pro obnovu.', 'Invalid recovery phrase.'));
    const wallet = hdWallet(phrase, Number(ctx.opts.index ?? 0));
    const path = await store(ctx, name, wallet);
    ctx.print({ name, address: wallet.address, path }, summary(name, wallet.address, path));
  },

  async 'import-key'(ctx, rest) {
    const name = needName(ctx, rest);
    const key = await secretInput(ctx, 'key-file', L('Soukromý klíč: ', 'Private key: '));
    let wallet;
    try { wallet = new ethers.Wallet(key.startsWith('0x') ? key : `0x${key}`); } catch { throw new CliError(L('Neplatný soukromý klíč.', 'Invalid private key.')); }
    const path = await store(ctx, name, wallet);
    ctx.print({ name, address: wallet.address, path }, summary(name, wallet.address, path));
  },

  /** Stejná peněženka jako v aplikaci: z jejího trezoru, heslem aplikace. Fráze se nemusí opisovat. */
  async 'import-app'(ctx, rest) {
    const name = needName(ctx, rest);
    const { accounts, selected, secret } = await appAccounts(ctx);
    if (!accounts.length) throw new CliError(L('Peněženka aplikace nemá žádný účet.', 'The app wallet has no account.'));
    const index = ctx.opts.index === undefined ? Math.min(selected, accounts.length - 1) : Number(ctx.opts.index);
    if (!Number.isInteger(index) || index < 0 || index >= accounts.length) throw new CliError(L(`Účet ${ctx.opts.index} v aplikaci není, má jich ${accounts.length} (číslují se od 0).`, `There is no account ${ctx.opts.index} in the app, it has ${accounts.length} (numbered from 0).`));
    const wallet = accounts[index];
    const path = await store(ctx, name, wallet, secret);
    ctx.print({ name, address: wallet.address, path, index }, `${summary(name, wallet.address, path)}\n${L('Stejná adresa jako v aplikaci. Heslo zůstává stejné, pokud má aspoň 10 znaků.', 'The same address as in the app. The password stays the same if it has at least 10 characters.')}`);
  },

  async list(ctx) {
    const main = defaultName();
    const rows = listWallets().map((name) => ({ name, address: addressOf(name), default: name === main }));
    if (ctx.opts.json) { ctx.print(rows); return; }
    console.log(rows.length ? table(['', L('Název', 'Name'), L('Adresa', 'Address')], rows.map((r) => [r.default ? '*' : '', r.name, r.address])) : NO_WALLET());
  },

  async show(ctx, rest) {
    if (rest[0]) ctx.opts.wallet = rest[0];
    const name = chosenWallet(ctx);
    const info = { name, address: addressOf(name), path: fileOf(name), default: name === defaultName() };
    ctx.print(info, pairs([[L('Peněženka', 'Wallet'), name], [L('Adresa', 'Address'), info.address], [L('Soubor', 'File'), info.path], [L('Výchozí', 'Default'), yesNo(info.default)]]));
  },

  async default(ctx, rest) {
    if (rest[0]) ctx.opts.wallet = rest[0];
    const name = chosenWallet(ctx);
    writeSafe(join(dir(), DEFAULT_FILE), name);
    ctx.print({ default: name }, L(`Výchozí peněženka: ${name}`, `Default wallet: ${name}`));
  },

  async phrase(ctx, rest) {
    if (rest[0]) ctx.opts.wallet = rest[0];
    const wallet = await unlock(ctx);
    if (!wallet.mnemonic) throw new CliError(L('Tato peněženka vznikla z klíče, fráze u ní není.', 'This wallet was made from a key, it has no phrase.'));
    showSecret(ctx, L('Fráze pro obnovu:', 'Recovery phrase:'), wallet.mnemonic.phrase);
  },

  async key(ctx, rest) {
    if (rest[0]) ctx.opts.wallet = rest[0];
    const wallet = await unlock(ctx);
    showSecret(ctx, L('Soukromý klíč:', 'Private key:'), wallet.privateKey);
  },

  async password(ctx, rest) {
    if (rest[0]) ctx.opts.wallet = rest[0];
    const name = chosenWallet(ctx);
    const wallet = await unlock(ctx);
    if (ctx.opts['password-file']) throw new CliError(L('Nové heslo se zadává jen ručně, bez --password-file.', 'The new password can only be typed in, without --password-file.'));
    writeSafe(fileOf(name), await wallet.encrypt(await newPassword(ctx)));
    ctx.print({ name }, L(`Heslo peněženky ${name} je změněné.`, `The password of wallet ${name} is changed.`));
  },

  async remove(ctx, rest) {
    if (rest[0]) ctx.opts.wallet = rest[0];
    const name = chosenWallet(ctx);
    if (!ctx.opts.yes) {
      console.error(L(`Soubor peněženky ${name} se smaže. Mince zůstanou na adrese ${addressOf(name)}, ale dostanete se k nim jen s frází nebo klíčem.`, `The wallet file ${name} will be deleted. The coins stay at ${addressOf(name)}, but you can reach them only with the phrase or the key.`));
      if (await ask(L(`Pro potvrzení napište název ${name}: `, `To confirm, type the name ${name}: `)) !== name) throw new CliError(L('Zrušeno.', 'Cancelled.'));
    }
    unlinkSync(fileOf(name));
    ctx.print({ removed: name }, L(`Peněženka ${name} je smazaná z tohoto počítače.`, `Wallet ${name} is deleted from this computer.`));
  },
};

/** quinvium login: v terminálu se nepřihlašuje na dobu sezení. Vybere se peněženka a heslo se zadá při každém podpisu. */
export async function login(ctx, [name]) {
  if (name) {
    ctx.opts.wallet = name;
    const chosen = chosenWallet(ctx);
    writeSafe(join(dir(), DEFAULT_FILE), chosen);
  }
  const list = listWallets();
  if (!list.length) {
    console.log(L(`V terminálu zatím není žádná peněženka. Vyberte jednu z cest:

  quinvium wallet create            nová peněženka s frází pro obnovu
  quinvium wallet import            stejná adresa jako v MetaMasku nebo jiné peněžence, z fráze
  quinvium wallet import-app        stejná peněženka jako v aplikaci Quinvium, jen heslem
  quinvium wallet import-key        ze soukromého klíče`, `There is no wallet in the terminal yet. Choose one way:

  quinvium wallet create            a new wallet with a recovery phrase
  quinvium wallet import            the same address as in MetaMask or another wallet, from the phrase
  quinvium wallet import-app        the same wallet as in the Quinvium app, with its password
  quinvium wallet import-key        from a private key`));
    return;
  }
  const current = defaultName();
  ctx.print({ wallet: current, address: addressOf(current), wallets: list }, `${pairs([[L('Peněženka', 'Wallet'), current], [L('Adresa', 'Address'), addressOf(current)]])}
${L(`Heslo se zadává při každém podpisu, mezi příkazy nic nezůstává odemčené. Jinou peněženku zvolíte: quinvium login <název> (${list.join(', ')}).`, `The password is asked at each signature, nothing stays unlocked between commands. Choose another wallet with: quinvium login <name> (${list.join(', ')}).`)}`);
}

export async function walletCommand(ctx, [sub, ...rest]) {
  const fn = COMMANDS[sub ?? 'list'];
  if (!fn) throw new CliError(L(`Neznámý příkaz wallet ${sub}. Možnosti: ${Object.keys(COMMANDS).join(', ')}`, `Unknown command wallet ${sub}. Options: ${Object.keys(COMMANDS).join(', ')}`));
  await fn(ctx, rest);
}
