# Governance: how Quinvium changes

Quinvium has no owner, no admin key and no on-chain vote that can change its rules. A rule change takes effect only when node operators, miners, exchanges and wallets **choose to run** a release that contains it. This document describes the public process a change must go through before it is even offered to them. It follows the Ethereum model (EIPs, multiple reviewers, testnet first, fixed fork heights) with stricter time limits.

## What counts as a consensus change

Anything that can make two honest nodes disagree about which blocks are valid:

- block validity, proof-of-work (Ethash), difficulty, block time, gas rules, the EVM and its version, precompiles;
- issuance: block reward, halving, supply cap, where fees go;
- genesis, system contracts and their addresses, fork heights, chain ID;
- the exact versions of EthereumJS and cryptography libraries used by the node.

The code for these lives in the paths listed in [`scripts/consensus-paths.json`](../scripts/consensus-paths.json). Changes there are guarded automatically (see "Protection" below).

Everything else (wallets, Explorer, RPC methods, networking performance, the website) follows the normal pull request process.

## The process: QIP

Every consensus change needs a **Quinvium Improvement Proposal (QIP)** in [`docs/qips`](qips/). Template: [`qips/qip-template.md`](qips/qip-template.md).

| Stage | What happens | Minimum time |
| --- | --- | --- |
| Draft | Pull request with the QIP: motivation, exact rules, security considerations, test vectors, backwards compatibility | none |
| Review | Public discussion in the QIP pull request and on [t.me/Quinvium](https://t.me/Quinvium). Anyone may comment | 30 days |
| Last Call | Final text announced on the website, X and Telegram; only fixes, no new features | 14 days |
| Accepted | Implementation merged behind a fork that is **not active** on any network | none |
| Testnet | Fork active on testnet at a fixed height, without problems | **60 days** |
| Scheduled | Mainnet release with the fork height fixed in the code, announced everywhere | **90 days** before the fork height |
| Final | The fork is active on mainnet | none |

A QIP that fails at any stage goes back to Draft or becomes Withdrawn. Nobody can skip a stage, including the original author of the project.

### Rules for every consensus release

1. **Fixed height, never a switch.** A fork activates at a block height written into the release (`network.forks` in `params.js`). There is no remote flag, no admin transaction and no key that turns rules on or off.
2. **Golden tests change on purpose.** `packages/node/test/golden.test.js` pins genesis and block hashes. A consensus change must update it in the same pull request, and the pull request must name the accepted QIP. A pull request that touches consensus code without changing the golden tests must state "No consensus change", and the golden tests prove it.
3. **Fork ID.** Nodes with different rules disconnect from each other by themselves (EIP-2124), so a node that did not upgrade is never silently on the wrong chain.
4. **Two independent reviewers** approve every consensus pull request once the project has more than one maintainer. Until then the 90-day public notice is the review.
5. **Signed releases.** Every release has `SHA256SUMS` and its source tag on GitHub. The goal is reproducible builds so that anyone can check that a binary matches the code.
6. **No new trust.** A QIP may not add an owner, an admin key, a fee recipient, a pause function or anything else that gives one party control over the chain or other people's coins.
7. **Supply is final.** The 64 million QU cap, the halving schedule and "no premine" are not open for change by QIP.

### Miner signalling

Miners can show support for an accepted QIP by putting `QIP-<n>` into the extra data of the blocks they mine, for example a solo miner's node started with `--extra "Quinvium QIP-7"` (at most 32 bytes). The node counts the signals of the last day with the RPC method `quinvium_signals`, and the Explorer shows them on the Network page. Signalling is **informative only**: it does not activate anything. What decides is which release people run.

## Security fixes

A bug that is being exploited right now may need a faster release. The rules:

- The fix must be the **smallest possible** change and, where possible, make rules stricter (a soft fork) rather than looser.
- It is announced publicly at release time on the website, X and Telegram, with the reason.
- The minimum notice is **14 days** unless funds are being stolen at that moment.
- A written post-mortem follows within 7 days and the change gets a QIP after the fact.

Vulnerabilities are reported privately, see [SECURITY.md](../SECURITY.md).

## Protection of the code

| Protection | What it does |
| --- | --- |
| Protected `main` branch | No direct pushes and no force pushes, also for administrators. Every change goes through a pull request |
| Required CI | Node, contracts, bridge, Explorer and announcer tests on Linux and Windows must pass before merging |
| Release tags | Tags `v*` can be created, moved or deleted only by administrators |
| CodeQL and Dependabot | Static security analysis on every pull request and weekly; Dependabot opens security fixes (routine version updates only for GitHub Actions, because a library update can be a hard fork) |
| Secret scanning | Pushes that contain a known key format are blocked |
| Consensus guard | [`scripts/consensus-guard.mjs`](../scripts/consensus-guard.mjs) runs on every pull request: a change of consensus paths needs either an accepted QIP or the statement "No consensus change" |
| CODEOWNERS | Consensus paths need a review by a code owner (enforced as soon as the project has a second maintainer; GitHub does not let anyone approve their own pull request) |
| Golden tests | Any unintended rule change breaks pinned hashes |

## Who decides

Nobody alone. Maintainers decide what is merged into this repository, but they cannot force anyone to run it. If a change is rejected by the people who run nodes and mine, it does not happen, and anyone can fork the code under the MIT license. That is the final check on everyone, including the people who started the project.
