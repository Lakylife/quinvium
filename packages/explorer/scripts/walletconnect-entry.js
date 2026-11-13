// Vstup pro balíček public/walletconnect.js. Verze je pevná: 2.21.8 je poslední pod licencí Apache-2.0,
// novější mají licenci s limitem 500 aktivních uživatelů měsíčně pro komerční použití.
import { EthereumProvider } from '@walletconnect/ethereum-provider';

window.AetherWalletConnect = {
  /**
   * Naše síť je v telefonních peněženkách neznámá, proto je volitelná. Povinná síť by připojení rovnou odmítla.
   * Přidání sítě pak řeší stejný krok jako u ostatních peněženek (wallet_addEthereumChain).
   */
  init: ({ projectId, chainId, rpcUrl, metadata }) => EthereumProvider.init({
    projectId,
    metadata,
    showQrModal: false,
    optionalChains: [chainId],
    rpcMap: { [chainId]: rpcUrl },
    optionalMethods: [
      'eth_accounts', 'eth_chainId', 'eth_requestAccounts', 'eth_sendTransaction', 'personal_sign',
      'eth_signTypedData_v4', 'wallet_addEthereumChain', 'wallet_switchEthereumChain',
    ],
    optionalEvents: ['accountsChanged', 'chainChanged', 'disconnect'],
  }),
};
