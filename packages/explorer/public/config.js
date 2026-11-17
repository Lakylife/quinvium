// Explorer operator settings. A WalletConnect Project ID is free at dashboard.reown.com.
// If it stays empty, the page asks the visitor for it and stores it only in their browser.
// rpc: nodes for the Explorer on a domain, for example ['https://rpc1.example.org', 'https://rpc2.example.org']. The Explorer picks
// the one with the highest block and switches to the next on failure. An empty array: the node the page was loaded from.
// The Explorer on Quinvium domains reads from its network's public node: explorer.quinvium.com mainnet, testnet.quinvium.com testnet.
// Elsewhere (the Explorer in the app, your own node) from the node it was loaded from.
window.AETHER_CONFIG = {
  walletConnectProjectId: '',
  rpc: ({ 'explorer.quinvium.com': ['https://rpc.quinvium.com'], 'testnet.quinvium.com': ['https://rpc1.quinvium.com'] })[location.hostname] ?? [],
  // The chain shown on a Quinvium domain. Community nodes and the visitor's own node are used only when they show the same
  // chain ID and genesis block. Empty elsewhere: the Explorer in the app or on a node trusts that node.
  expect: ({
    'explorer.quinvium.com': { chainId: 52401, genesis: '0x49c889ad9d4f44869cf7f97a6e079a50dbf13974263b1afedec3b774ebeeac39' },
    'testnet.quinvium.com': { chainId: 52402, genesis: '0x4845f69c270efcf1f74a789a9ad85d31a5128a1907a7fdf5d1dd131eebaed121' },
  })[location.hostname] ?? null,
};
