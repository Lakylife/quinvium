// EIP-1193 and EIP-6963 provider on the page. It knows no keys; it only relays requests.
(() => {
  if (window.quinvium || window.quintium || window.aether) return;
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;
  let chainId = null;
  let accounts = [];

  const emit = (event, ...args) => { for (const fn of listeners.get(event) ?? []) { try { fn(...args); } catch (e) { console.error(e); } } };

  const provider = {
    isAether: true,
    isMetaMask: false,
    get chainId() { return chainId; },
    get selectedAddress() { return accounts[0] ?? null; },
    isConnected: () => true,
    request({ method, params }) {
      if (typeof method !== 'string') return Promise.reject(Object.assign(new Error('Neplatný požadavek'), { code: -32600 }));
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        window.postMessage({ source: 'aether-inpage', id, method, params: params ?? [] }, window.location.origin);
      });
    },
    enable() { return this.request({ method: 'eth_requestAccounts' }); },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return this;
    },
    removeListener(event, fn) { listeners.get(event)?.delete(fn); return this; },
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'aether-content') return;
    const m = e.data;
    if (m.event) {
      if (m.event === 'chainChanged') chainId = m.data;
      if (m.event === 'accountsChanged') accounts = m.data;
      emit(m.event, m.data);
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    // The data field carries the contract's error code; the page shows an understandable reason based on it.
    if (m.error) p.reject(Object.assign(new Error(m.error.message), { code: m.error.code ?? -32603, data: m.error.data }));
    else p.resolve(m.result);
  });

  // The Quinvium wallet has its own window.quinvium object. The earlier names window.quintium and window.aether remain for older pages.
  const frozen = Object.freeze(provider);
  Object.defineProperty(window, 'quinvium', { value: frozen, writable: false, configurable: false });
  Object.defineProperty(window, 'quintium', { value: frozen, writable: false, configurable: false });
  Object.defineProperty(window, 'aether', { value: frozen, writable: false, configurable: false });
  if (!window.ethereum) window.ethereum = provider;

  const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3ClinearGradient id='g' x1='12' y1='6' x2='52' y2='58' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='0' stop-color='%23FBE3A0'/%3E%3Cstop offset='.5' stop-color='%23E8B44A'/%3E%3Cstop offset='1' stop-color='%23A9751A'/%3E%3C/linearGradient%3E%3Cpath d='M32 3 57 17.5v29L32 61 7 46.5v-29z' fill='url(%23g)'/%3E%3Cpath d='M32 13.5 47 47h-8l-2.700-6.400H27.700L25 47h-8zM32 26l-2.100 7.800h4.200z' fill='%231B1405' fill-rule='evenodd'/%3E%3C/svg%3E";
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({ info: Object.freeze({ uuid: 'a37e7e2a-3c33-4d38-9a5d-ae7e77a1e700', name: 'Quinvium Wallet', icon, rdns: 'org.aether.wallet' }), provider }),
  }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
})();
