// Explorer operator settings. A WalletConnect Project ID is free at dashboard.reown.com.
// If it stays empty, the page asks the visitor for it and stores it only in their browser.
// rpc: nodes for the Explorer on a domain, for example ['https://rpc1.example.org', 'https://rpc2.example.org']. The Explorer picks
// the one with the highest block and switches to the next on failure. An empty array: the node the page was loaded from.
// The Explorer on Quinvium domains reads from its network's public node: explorer.quinvium.com mainnet, testnet.quinvium.com testnet.
// Elsewhere (the Explorer in the app, your own node) from the node it was loaded from.
window.AETHER_CONFIG = {
  walletConnectProjectId: '',
  rpc: ({ 'explorer.quinvium.com': ['https://rpc.quinvium.com'], 'testnet.quinvium.com': ['https://rpc1.quinvium.com'] })[location.hostname] ?? [],
};
