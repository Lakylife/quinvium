// Bridge between the page and the extension core. The browser determines where a request comes from, not the page.
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
    window.postMessage({ source: 'aether-content', id, error: { code: 4900, message: 'The wallet was updated, reload the page' } }, window.location.origin);
  }
});
