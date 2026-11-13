// Příkaz quinvium (dříve quintium) v terminálu. Spouštěč leží v datech aplikace (stálá cesta) a aplikace ho při každém startu
// přepíše na právě používanou verzi. Aktualizace přes internet má vlastní složku s novou příkazovou řádkou,
// odkaz do instalace by po ní dál spouštěl starou verzi.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

/** Text uvnitř uvozovek v sh: zpětné lomítko, uvozovky, dolar a obrácený apostrof se musí uvodit. */
const sh = (text) => String(text).replace(/[\\"$`]/g, (c) => `\\${c}`);

/** Cesta ve Windows přes proměnnou prostředí. V souboru .cmd tak nezůstane diakritika ze jména uživatele. */
function winPath(p, env) {
  for (const name of ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE']) {
    const base = env[name];
    if (base && p.toLowerCase().startsWith(`${base.toLowerCase()}\\`)) return `%${name}%${p.slice(base.length)}`;
  }
  return p;
}

/**
 * @param {{dir: string, execPath: string, bundle: string, fallback: string, platform: string, env: object}} o
 *   bundle: příkazová řádka právě běžící verze, fallback: ta z instalace pro případ, že složka verze zmizí
 * @returns {string} cesta ke spouštěči
 */
function writeLauncher({ dir, execPath, bundle, fallback, platform, env = process.env }) {
  fs.mkdirSync(dir, { recursive: true });
  const win = platform === 'win32';
  const file = path.join(dir, win ? 'quintium.cmd' : 'quintium');
  const text = win
    ? ['@echo off',
      'rem Prikazova radka Quinvium z prave pouzivane verze aplikace. Aplikace tento soubor obnovuje pri kazdem spusteni.',
      'setlocal',
      'set ELECTRON_RUN_AS_NODE=1',
      `set "B=${winPath(bundle, env)}"`,
      `if not exist "%B%" set "B=${winPath(fallback, env)}"`,
      `"${winPath(execPath, env)}" "%B%" cli %*`, ''].join('\r\n')
    : ['#!/bin/sh',
      '# Příkazová řádka Quinvium z právě používané verze aplikace. Aplikace tento soubor obnovuje při každém spuštění.',
      `B="${sh(bundle)}"`,
      `[ -f "$B" ] || B="${sh(fallback)}"`,
      `ELECTRON_RUN_AS_NODE=1 exec "${sh(execPath)}" "$B" cli "$@"`, ''].join('\n');
  // Příkaz quinvium je nové jméno, quintium zůstává pro starší návody a skripty. Oba soubory jsou stejné.
  for (const name of win ? ['quintium.cmd', 'quinvium.cmd'] : ['quintium', 'quinvium']) {
    const target = path.join(dir, name);
    let old = null;
    try { old = fs.readFileSync(target, 'utf8'); } catch { /* první spuštění */ }
    if (old !== text) {
      fs.writeFileSync(`${target}.tmp`, text, { mode: 0o755 });
      fs.renameSync(`${target}.tmp`, target);
    }
    if (!win) fs.chmodSync(target, 0o755);
  }
  return file;
}

/** Profil shellu, do kterého patří cesta: zsh je na macOS výchozí, bash má .bash_profile. */
const profileOf = ({ home, shell, profile }) => profile ?? path.join(home, /bash$/.test(shell ?? '') ? '.bash_profile' : '.zshrc');

/** Řádek, který si uživatel může spustit sám. Dělá totéž co tlačítko. */
function manualLine(dir, platform) {
  if (platform === 'win32') return `powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';${dir.replace(/'/g, "''")}', 'User')"`;
  return `echo 'export PATH="${sh(dir)}:$PATH"' >> ~/.zshrc`;
}

/**
 * Přidá složku spouštěče do cesty uživatele. Jen na jeho kliknutí: systémovou cestu ani cizí účty nemění.
 * Windows: uživatelská proměnná Path přes PowerShell (setx by ji zkrátil na 1024 znaků). macOS a Linux: řádek v profilu shellu.
 * @returns {Promise<{ok: boolean, added?: boolean, file?: string, error?: string}>}
 */
function installPath({ dir, platform, home, shell, profile, run = execFile }) {
  if (platform === 'win32') {
    const quoted = dir.replace(/'/g, "''");
    const script = `$d = '${quoted}'; $p = [Environment]::GetEnvironmentVariable('Path', 'User'); if (-not $p) { $p = '' }; `
      + 'if (($p -split \';\') -contains $d) { \'present\' } else { [Environment]::SetEnvironmentVariable(\'Path\', ($p.TrimEnd(\';\') + \';\' + $d).TrimStart(\';\'), \'User\'); \'added\' }';
    return new Promise((resolve) => {
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30000 }, (e, out) => {
        if (e) resolve({ ok: false, error: e.message });
        else resolve({ ok: true, added: String(out).trim() === 'added' });
      });
    });
  }
  try {
    const file = profileOf({ home, shell, profile });
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { /* profil zatím neexistuje */ }
    if (text.includes(dir) || text.includes(sh(dir))) return Promise.resolve({ ok: true, added: false, file });   // v profilu je cesta uvozená
    const lead = text && !text.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(file, `${lead}\n# Quinvium: příkazy quinvium a quintium v terminálu\nexport PATH="${sh(dir)}:$PATH"\n`);
    return Promise.resolve({ ok: true, added: true, file });
  } catch (e) {
    return Promise.resolve({ ok: false, error: e.message });
  }
}

module.exports = { writeLauncher, installPath, manualLine, profileOf };
