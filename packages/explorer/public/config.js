// Nastavení provozovatele Exploreru. Project ID pro WalletConnect je zdarma na dashboard.reown.com.
// Když zůstane prázdné, stránka o něj požádá návštěvníka a uloží si ho jen v jeho prohlížeči.
// rpc: uzly pro Explorer na doméně, třeba ['https://rpc1.domena.cz', 'https://rpc2.domena.cz']. Explorer vybere
// ten s nejvyšším blokem a při výpadku přejde na další. Prázdné pole: uzel, ze kterého se stránka načetla.
// Explorer na doménách Quinvia bere data z veřejného uzlu své sítě: explorer.quinvium.com mainnet, testnet.quinvium.com testnet.
// Jinde (Explorer v aplikaci, vlastní uzel) z uzlu, ze kterého se načetl.
window.AETHER_CONFIG = {
  walletConnectProjectId: '',
  rpc: ({ 'explorer.quinvium.com': ['https://rpc.quinvium.com'], 'testnet.quinvium.com': ['https://rpc1.quinvium.com'] })[location.hostname] ?? [],
};
