// Peněženka aplikace pro okno Exploreru. Stránka smí jen posílat žádosti, klíče zůstávají v hlavním okně
// a vše citlivé schvaluje uživatel tam. Původ žádosti určuje hlavní proces, ne stránka.
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();
ipcRenderer.on('wallet:event', (_, { event, data }) => {
  for (const fn of listeners.get(event) ?? []) fn(data);
});

const wallet = {
  isAether: true,
  isDesktop: true,
  isMetaMask: false,
  async request({ method, params }) {
    const answer = await ipcRenderer.invoke('wallet:request', { method, params });
    // Prostý objekt: přes hranici okna by chyba ztratila kód, podle kterého stránka reaguje.
    if (answer.error) throw answer.error;
    return answer.result;
  },
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
  },
  removeListener(event, fn) { listeners.get(event)?.delete(fn); },
};
// Stejná peněženka pod novým i dřívějším názvem, Explorer i starší stránky ji najdou.
contextBridge.exposeInMainWorld('quinvium', wallet);
contextBridge.exposeInMainWorld('quintium', wallet);   // dřívější jméno, stránky ho mohou dál používat
contextBridge.exposeInMainWorld('aether', wallet);

// Práce ve vloženém Exploreru se počítá jako aktivita, aplikace se během ní nezamkne.
const ACTIVITY_MS = 30_000;
let reported = 0;
const activity = () => {
  if (Date.now() - reported < ACTIVITY_MS) return;
  reported = Date.now();
  ipcRenderer.invoke('wallet:activity').catch(() => {});
};
for (const type of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(type, activity, { capture: true, passive: true });
