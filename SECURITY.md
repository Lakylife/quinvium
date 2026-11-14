# Security policy

Quinvium is experimental software. No independent security audit has been done yet; see [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md) for what is tested and what the known risks are.

## Reporting a vulnerability

Please **do not** open a public issue for a vulnerability that could put funds or the network at risk.

Report it privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability** (a private security advisory). Include:

- the affected component (node, consensus, P2P, contracts, wallet, app, miner, bridge),
- the version or commit,
- steps to reproduce or a proof of concept,
- the impact you expect.

You will get an answer as soon as possible. Please give a reasonable time to prepare and release a fix before disclosing the issue publicly.

## Scope

In scope: consensus rules and their implementation in `packages/node`, the P2P protocol, JSON-RPC, the system contracts in `packages/contracts`, the wallets (`packages/extension`, `packages/desktop`), the miner and the bridge validators.

Out of scope: the 51 % attack inherent to proof-of-work (see the security model), reports about third-party services, and issues that require a compromised computer.

## Supported versions

Only the latest release receives fixes. On mainnet, remote updates of the desktop app are switched off; new versions are published on https://quinvium.com/download/ and in GitHub Releases with SHA-256 checksums.
