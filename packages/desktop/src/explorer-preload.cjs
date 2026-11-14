// The app's wallet for the Explorer window. The page may only send requests; keys stay in the main window
// and the user approves everything sensitive there. The main process determines where a request comes from, not the page.
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
    // A plain object: across the window boundary an error would lose the code the page reacts to.
    if (answer.error) throw answer.error;
    return answer.result;
  },
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
  },
  removeListener(event, fn) { listeners.get(event)?.delete(fn); },
};
// The same wallet under the new and the earlier name; the Explorer and older pages both find it.
contextBridge.exposeInMainWorld('quinvium', wallet);
contextBridge.exposeInMainWorld('quintium', wallet);   // earlier name; pages may keep using it
contextBridge.exposeInMainWorld('aether', wallet);

// Working in the embedded Explorer counts as activity; the app does not lock meanwhile.
const ACTIVITY_MS = 30_000;
let reported = 0;
const activity = () => {
  if (Date.now() - reported < ACTIVITY_MS) return;
  reported = Date.now();
  ipcRenderer.invoke('wallet:activity').catch(() => {});
};
for (const type of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(type, activity, { capture: true, passive: true });
