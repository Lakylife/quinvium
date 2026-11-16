// The quinvium command (formerly quintium) in the terminal. The launcher lives in the app data (a permanent path) and the app on every start
// to the version currently in use. An update over the internet has its own folder with a new command line,
// a link into the installation would keep starting the old version after it.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

/** Text inside double quotes in sh: backslash, quotes, dollar and backtick must be escaped. */
const sh = (text) => String(text).replace(/[\\"$`]/g, (c) => `\\${c}`);

/** On Windows the path goes through an environment variable, so no diacritics from the user name end up in the .cmd file. */
function winPath(p, env) {
  for (const name of ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE']) {
    const base = env[name];
    if (base && p.toLowerCase().startsWith(`${base.toLowerCase()}\\`)) return `%${name}%${p.slice(base.length)}`;
  }
  return p;
}

/**
 * @param {{dir: string, execPath: string, bundle: string, fallback: string, platform: string, env: object}} o
 *   bundle: the command line of the running version, fallback: the one from the installation in case the version folder disappears
 * @returns {string} path to the launcher
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
      '# Quinvium command line from the app version currently in use. The app rewrites this file on every start.',
      `B="${sh(bundle)}"`,
      `[ -f "$B" ] || B="${sh(fallback)}"`,
      `ELECTRON_RUN_AS_NODE=1 exec "${sh(execPath)}" "$B" cli "$@"`, ''].join('\n');
  // quinvium is the new command name; quintium stays for older guides and scripts. Both files are identical.
  for (const name of win ? ['quintium.cmd', 'quinvium.cmd'] : ['quintium', 'quinvium']) {
    const target = path.join(dir, name);
    let old = null;
    try { old = fs.readFileSync(target, 'utf8'); } catch { /* first start */ }
    if (old !== text) {
      fs.writeFileSync(`${target}.tmp`, text, { mode: 0o755 });
      fs.renameSync(`${target}.tmp`, target);
    }
    if (!win) fs.chmodSync(target, 0o755);
  }
  return file;
}

/** The shell profile the path belongs in: zsh is the default on macOS, bash has .bash_profile. */
const profileOf = ({ home, shell, profile }) => profile ?? path.join(home, /bash$/.test(shell ?? '') ? '.bash_profile' : '.zshrc');

/** A line the user can run themselves. It does the same as the button. */
function manualLine(dir, platform) {
  if (platform === 'win32') return `powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';${dir.replace(/'/g, "''")}', 'User')"`;
  return `echo 'export PATH="${sh(dir)}:$PATH"' >> ~/.zshrc`;
}

/**
 * Adds the launcher folder to the user's path. Only on their click: it changes neither the system path nor other accounts.
 * Windows: the user Path variable through PowerShell (setx would truncate it to 1024 characters). macOS and Linux: a line in the shell profile.
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
    try { text = fs.readFileSync(file, 'utf8'); } catch { /* the profile does not exist yet */ }
    if (text.includes(dir) || text.includes(sh(dir))) return Promise.resolve({ ok: true, added: false, file });   // the path in the profile is quoted
    const lead = text && !text.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(file, `${lead}\n# Quinvium: the quinvium and quintium commands in the terminal\nexport PATH="${sh(dir)}:$PATH"\n`);
    return Promise.resolve({ ok: true, added: true, file });
  } catch (e) {
    return Promise.resolve({ ok: false, error: e.message });
  }
}

module.exports = { writeLauncher, installPath, manualLine, profileOf };
