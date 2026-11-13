// Kontrola řetězce z příkazové řádky. Kód uzlu se načítá až tady, ostatní příkazy startují rychle.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CliError, pairs, units } from './context.js';
import { L } from './i18n.js';

/** Data aplikace, nebo samostatného uzlu. Aplikace má přednost, tam je řetězec, který se právě používá. */
function dataFolder(ctx) {
  const folder = ctx.network.folder ?? ctx.networkName;
  const app = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'Aether')
    : process.platform === 'win32' ? join(process.env.APPDATA ?? homedir(), 'Aether') : join(homedir(), '.config', 'Aether');
  const places = [join(app, 'chain', folder), join(homedir(), '.aether', folder)];
  const found = places.find((p) => existsSync(join(p, 'chain.db')));
  if (!found) throw new CliError(L(`Databáze sítě ${ctx.networkName} se nenašla. Zadejte složku přes --data-dir.`, `The ${ctx.networkName} database was not found. Give its folder with --data-dir.`));
  return found;
}

export async function audit(ctx) {
  const dataDir = ctx.opts['data-dir'] ?? dataFolder(ctx);
  const { auditChain } = await import('../../node/src/audit.js');
  ctx.note(L(`Kontroluji ${dataDir}\nDatabáze se jen čte, uzel může běžet dál.`, `Checking ${dataDir}\nThe database is only read, the node can keep running.`));
  const report = await auditChain({
    network: ctx.network, dataDir, quick: ctx.opts.quick,
    onProgress: (done, total) => { if (!ctx.opts.json) process.stderr.write(`\r${L(`${done} z ${total} bloků`, `${done} of ${total} blocks`)}`); },
  });
  if (!ctx.opts.json && Number(report.height) >= 1000) process.stderr.write('\n');
  ctx.print(report, [
    pairs([
      [L('Výška', 'Height'), report.height], [L('Provedené bloky', 'Executed blocks'), ctx.opts.quick ? L('přeskočeno', 'skipped') : report.blocks], [L('Transakce', 'Transactions'), ctx.opts.quick ? undefined : report.transactions],
      [L('Stavové uzly', 'State nodes'), L(`${report.stateNodes}, každý ověřený hashem`, `${report.stateNodes}, each checked by its hash`)], [L('Účty ve stavu', 'Accounts in state'), report.accounts],
      [L('Mincí v řetězci', 'Coins on chain'), report.supply === undefined ? undefined : `${units(report.supply, 18, 18)} ${ctx.symbol}`], [L('Smělo vzniknout', 'Allowed to exist'), `${units(report.emitted, 18, 18)} ${ctx.symbol}`],
      [L('Zaniklo', 'Burned'), report.burned ? `${units(report.burned, 18, 18)} ${ctx.symbol}` : undefined],
    ]),
    report.ok ? L('\nV pořádku: všechny bloky, podpisy, práce i součet mincí sedí.', '\nAll good: every block, signature, proof of work and the coin total match.') : `\n${L('NALEZENÉ PROBLÉMY', 'PROBLEMS FOUND')} (${report.problems.length}):\n${report.problems.map((p) => `  - ${p}`).join('\n')}`,
  ].join('\n'));
  if (!report.ok) process.exitCode = 1;
}
