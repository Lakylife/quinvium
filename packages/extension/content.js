// Most mezi stránkou a jádrem rozšíření. Původ požadavku určuje prohlížeč, ne stránka.
let port = null;

function connect() {
  port = chrome.runtime.connect({ name: 'dapp' });
  port.onMessage.addListener((m) => window.postMessage({ source: 'aether-content', ...m }, window.location.origin));
  port.onDisconnect.addListener(() => { port = null; });
}

window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== 'aether-inpage') return;
  const { id, method, params } = e.data;
  try {
    if (!port) connect();
    port.postMessage({ id, method, params });
  } catch {
    window.postMessage({ source: 'aether-content', id, error: { code: 4900, message: 'Peněženka byla aktualizována, obnovte stránku' } }, window.location.origin);
  }
});
