# Contributing

Quinvium is a decentralised network and open-source software. Contributions are welcome: code, tests, documentation, translations, reviews and running public nodes.

## Before you start

- For larger changes, open an issue first to discuss the idea.
- **Consensus changes need an accepted QIP** ([docs/GOVERNANCE.md](docs/GOVERNANCE.md), [docs/qips](docs/qips/)): 30 days of review, 14 days of last call, 60 days on testnet, 90 days of notice before the mainnet fork. A pull request that touches consensus code must say `Implements QIP-<n>` or `No consensus change`; CI checks it.
- **Consensus changes are hard forks.** Anything that changes block validity, rewards, the EVM rules or genesis needs a fork with an activation height (see [docs/SPECIFICATION.md](docs/SPECIFICATION.md#10-network-upgrades)), must be tested on testnet first and requires updating the fingerprints in `packages/node/test/golden.test.js`.
- Dependencies that affect consensus have exact versions in `packages/node/package.json`. Updating them is treated as a potential hard fork.

## Development

```bash
npm install
npm test --workspace packages/node
npm test --workspace packages/contracts
cargo test --release --manifest-path packages/miner/Cargo.toml
```

Node.js 24 is required. Browser tests (`packages/explorer/test/*.mjs`, `packages/extension/test/e2e.mjs`, `packages/desktop/test/e2e.mjs`) use Playwright.

## Pull requests

- Keep changes focused and add tests for new behaviour and for every fixed bug.
- Run the relevant test suites before opening a pull request.
- Never commit private keys, recovery phrases, `.env` files or wallet files.
- User-facing text in the app and the command line exists in English and Czech (`L('cs', 'en')` helpers and `i18n.js` files); the Explorer has five languages. Please add new strings in all existing languages, or in English and mark the rest for translation.

## Security issues

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contributions are licensed under the [MIT licence](LICENSE).

## Branch protection

`main` accepts changes only through pull requests with passing CI, also from maintainers. Force pushes and deleting the branch are not allowed.
