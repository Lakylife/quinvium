// Jazyk příkazové řádky. Hlavní jazyk sítě je angličtina, čeština se zvolí podle systému nebo volbou.
// Pořadí: --lang, proměnná QUINTIUM_LANG, uložená volba (quinvium lang cs), jazyk systému.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LANGUAGES = ['en', 'cs'];
let current = 'en';

const home = () => process.env.AETHER_HOME ?? join(homedir(), '.aether');
const settingsFile = () => join(home(), 'cli.json');

/** cs_CZ.UTF-8, cs-CZ, cs i en_US dají kód jazyka, C, POSIX a ostatní jazyky nic. */
export const languageOf = (value) => {
  const m = /^(en|cs)(?=$|[_.@-])/i.exec(String(value ?? '').trim());
  return m ? m[1].toLowerCase() : null;
};

function readSettings() {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}

export const savedLanguage = () => languageOf(readSettings().lang);

export function saveLanguage(lang) {
  mkdirSync(home(), { recursive: true, mode: 0o700 });
  const file = settingsFile();
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ ...readSettings(), lang }, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

/** Windows proměnnou LANG nemá, jazyk systému tam zná Intl. */
const systemLanguage = () => {
  const env = process.env;
  for (const v of [env.LC_ALL, env.LC_MESSAGES, env.LANG]) if (v) return languageOf(v);
  try { return languageOf(Intl.DateTimeFormat().resolvedOptions().locale); } catch { return null; }
};

/** Zvolí jazyk a předá ho i kódu uzlu (audit, quinvium node), který běží ve stejném procesu. */
export function chooseLanguage(option) {
  current = languageOf(option) ?? languageOf(process.env.QUINTIUM_LANG) ?? savedLanguage() ?? systemLanguage() ?? 'en';
  process.env.QUINTIUM_LANG = current;
  return current;
}

export const lang = () => current;

/** Text v obou jazycích na jednom místě: L('česky', 'English'). Vyhodnocuje se až při použití. */
export const L = (cs, en) => (current === 'cs' ? cs : en);
