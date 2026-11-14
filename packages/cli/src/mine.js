// Mining: starts quintium-miner the same way as the app. The reward goes to the chosen address; mining does not need the wallet key.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from './context.js';
import { L } from './i18n.js';
import { factoryPool } from './pool.js';
import { walletAddress } from './wallets.js';

const NAME = process.platform === 'win32' ? 'quintium-miner.exe' : 'quintium-miner';

/** Next to the tool in the package, next to Electron in the app, in the resources after a build, or in PATH. */
export function findMiner() {
  if (process.env.AETHER_MINER) return process.env.AETHER_MINER;
  const here = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));
  const places = [dirname(process.execPath), here, join(here, '..', '..', 'miner', 'target', 'release')];
  const found = places.map((p) => join(p, NAME)).find((p) => existsSync(p));
  if (found) return found;
  const inPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', [NAME], { encoding: 'utf8' });
  if (inPath.status === 0) return inPath.stdout.split(/\r?\n/)[0].trim();
  throw new CliError(L('Program quintium-miner se nenašel. Nastavte cestu v proměnné AETHER_MINER, nebo ho přidejte do PATH.', 'The quintium-miner program was not found. Set its path in the AETHER_MINER variable or add it to PATH.'));
}

export async function mine(ctx, args) {
  const miner = findMiner();
  if (ctx.opts.list) {
    process.exitCode = spawnSync(miner, ['--list'], { stdio: 'inherit' }).status ?? 1;
    return;
  }
  const address = ctx.opts.address ? await ctx.address(ctx.opts.address) : walletAddress(ctx);
  await ctx.connect();
  const flags = ['--address', address, '--intensity', String(ctx.opts.intensity ?? 100)];
  if (ctx.opts.device) flags.push('--device', ctx.opts.device);
  if (ctx.opts.backend) flags.push('--backend', ctx.opts.backend);
  let node = ctx.url;
  if (ctx.opts.pool) {
    const pool = await factoryPool(ctx, ctx.opts.pool);
    node = ctx.opts.server ?? await pool.url();
    if (!node) throw new CliError(L('Provozovatel poolu neuvedl adresu serveru. Zadejte ji přes --server.', 'The pool operator gave no server address. Give it with --server.'));
    flags.push('--pool', pool.target, '--worker', ctx.opts.worker ?? 'rig');
  }
  ctx.note(L(`Těžím na adresu ${address} přes ${node}. Ukončí Ctrl+C.`, `Mining to ${address} through ${node}. Stop with Ctrl+C.`));
  await new Promise((resolve, reject) => {
    const child = spawn(miner, ['--node', node, ...flags, ...args], { stdio: 'inherit' });
    const stop = () => child.kill('SIGTERM');
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    child.on('error', (e) => reject(new CliError(L(`Miner se nespustil: ${e.message}`, `The miner did not start: ${e.message}`))));
    child.on('exit', (code) => { process.exitCode = code ?? 0; resolve(); });
  });
}
