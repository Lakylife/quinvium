// Odeslání transakce: odhad, přehled, potvrzení, podpis a čekání na blok. Stejný postup pro všechny příkazy.
import { ethers } from 'ethers';
import { CliError, TX_WAIT_MS, ask, gwei, pairs, reason, units } from './context.js';
import { L } from './i18n.js';
import { unlock, walletAddress } from './wallets.js';

const GAS_MARGIN_PCT = 120n;

export async function confirm(ctx, text) {
  if (ctx.opts.yes) return;
  if (!process.stdin.isTTY) throw new CliError(L('Bez terminálu nejde potvrdit. Přidejte --yes, pokud to skript dělá záměrně.', 'Cannot confirm without a terminal. Add --yes if the script does this on purpose.'));
  const answer = (await ask(`${text ?? L('Odeslat?', 'Send?')} ${L('[a/N]', '[y/N]')} `)).trim();
  if (!/^(a|ano|y|yes)$/i.test(answer)) throw new CliError(L('Zrušeno.', 'Cancelled.'));
}

/** Heslo se chce až po přehledu a jen jednou, i když příkaz posílá víc transakcí. */
export async function signer(ctx) {
  ctx.signer ??= (await unlock(ctx)).connect(await ctx.connect());
  return ctx.signer;
}

const waitText = (seconds) => (seconds < 90 ? L(`asi ${seconds} s`, `about ${seconds} s`) : L(`asi ${Math.round(seconds / 60)} min`, `about ${Math.round(seconds / 60)} min`));

/**
 * @param {object} request pole transakce: to, data, value
 * @param {[string, string][]} lines co se uživateli ukáže před potvrzením
 * @param {{confirmed?: boolean, label?: string}} [o] confirmed: příkaz už se zeptal sám
 * @returns {Promise<{hash: string, block?: number, gasUsed?: string, pending?: boolean}>}
 */
export async function submit(ctx, request, lines = [], o = {}) {
  const provider = await ctx.connect();
  const from = walletAddress(ctx);
  const fees = await ctx.rpc('aether_feeEstimates');
  const tier = fees.tiers[ctx.feeTier()];
  let gas;
  try {
    gas = await provider.estimateGas({ ...request, from });
  } catch (e) {
    throw new CliError(L(`Transakce by selhala: ${reason(e)}`, `The transaction would fail: ${reason(e)}`));
  }
  const gasLimit = (gas * GAS_MARGIN_PCT) / 100n;
  const maxCost = gasLimit * BigInt(tier.maxFee);
  const value = BigInt(request.value ?? 0);
  const have = await provider.getBalance(from);
  if (have < value + maxCost) {
    throw new CliError(L(`Nedostatek ${ctx.symbol}: potřeba až ${units(value + maxCost)}, na adrese ${from} je ${units(have)}.`, `Not enough ${ctx.symbol}: up to ${units(value + maxCost)} is needed, ${from} holds ${units(have)}.`));
  }
  ctx.note(pairs([...lines, [L('Poplatek', 'Fee'), L(`nejvýše ${units(maxCost)} ${ctx.symbol} (${gwei(tier.maxFee)} gwei, ${waitText(tier.seconds)})`, `at most ${units(maxCost)} ${ctx.symbol} (${gwei(tier.maxFee)} gwei, ${waitText(tier.seconds)})`)]]));
  if (!o.confirmed) await confirm(ctx);
  const account = await signer(ctx);
  const sent = await account.sendTransaction({ ...request, gasLimit, maxFeePerGas: tier.maxFee, maxPriorityFeePerGas: tier.tip, type: 2, chainId: ctx.chainId })
    .catch((e) => { throw new CliError(L(`Uzel transakci nepřijal: ${reason(e)}`, `The node did not accept the transaction: ${reason(e)}`)); });
  ctx.note(`${o.label ?? L('Transakce', 'Transaction')}: ${sent.hash}`);
  if (ctx.opts['no-wait']) return { hash: sent.hash, pending: true };
  ctx.note(L('Čekám na blok…', 'Waiting for a block…'));
  try {
    const receipt = await sent.wait(1, TX_WAIT_MS);
    ctx.note(L(`Potvrzeno v bloku ${receipt.blockNumber}.`, `Confirmed in block ${receipt.blockNumber}.`));
    return { hash: sent.hash, block: receipt.blockNumber, gasUsed: receipt.gasUsed, logs: receipt.logs };
  } catch (e) {
    if (e.code === 'TIMEOUT') throw new CliError(L(`Transakce ${sent.hash} je odeslaná, ale zatím není v bloku. Těží někdo? Stav zobrazí: quinvium tx ${sent.hash}`, `Transaction ${sent.hash} is sent but not in a block yet. Is anyone mining? Check it with: quinvium tx ${sent.hash}`));
    throw new CliError(L(`Transakce ${sent.hash} v bloku selhala: ${reason(e)}. Důvod ukáže: quinvium tx ${sent.hash}`, `Transaction ${sent.hash} failed in the block: ${reason(e)}. See why with: quinvium tx ${sent.hash}`));
  }
}

/** Povolení přesně na tuto částku, ne napořád: kontrakt pak nesmí sáhnout na zbytek. */
export async function approve(ctx, token, spender, amount) {
  if (token.native) return;
  const from = walletAddress(ctx);
  const c = ctx.at('AetherToken', token.address);
  if (await c.allowance(from, spender) >= amount) return;
  await submit(ctx, { to: token.address, data: c.interface.encodeFunctionData('approve', [spender, amount]) }, [[L('Povolení', 'Approval'), `${units(amount, token.decimals)} ${token.symbol}`]], { confirmed: true, label: L('Povolení', 'Approval') });
}

export const encode = (contract, name, args) => contract.interface.encodeFunctionData(name, args);
export { ethers };
