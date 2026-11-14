// The wallet is the same code as the Chrome extension. This layer replaces the browser interface for it:
// the encrypted vault is saved to the app's file; the unlocked phrase only to the window's memory.
(() => {
  const listeners = { message: [], alarm: [], connect: [] };
  const sessionData = {};
  const timers = {};
  let localData = {};
  let saving = Promise.resolve();
  const pick = (data, keys) => {
    if (keys == null) return { ...data };
    const out = {};
    for (const k of [keys].flat()) if (k in data) out[k] = data[k];
    return out;
  };
  const persist = () => { saving = saving.then(() => window.desktop.saveWallet(localData)); return saving; };
  const ready = window.desktop.loadWallet().then((d) => { localData = d ?? {}; });
  const SENDER = { id: 'aether-desktop', url: 'chrome-extension://aether-desktop/desktop.html' };
  // Tests only: the test app has its node on its own port and the wallet must ask it, not the real node.
  if (window.desktop.testRpcPort) self.AETHER_TEST_RPC = `http://127.0.0.1:${window.desktop.testRpcPort}`;

  // The Explorer window talks to the wallet just as a page talks to the extension; instead of a browser port it goes through the main process.
  const ports = new Map();
  function dappPort(origin) {
    if (ports.has(origin)) return ports.get(origin);
    const receivers = [];
    const port = {
      name: 'dapp',
      sender: { origin },
      postMessage: (m) => window.desktop.walletAnswer(m),
      onMessage: { addListener: (fn) => receivers.push(fn) },
      onDisconnect: { addListener() {} },
      deliver: (m) => receivers.forEach((fn) => fn(m)),
    };
    ports.set(origin, port);
    listeners.connect.forEach((fn) => fn(port));
    return port;
  }
  window.desktop.onEvent((e) => {
    if (e.type === 'wallet-request') ready.then(() => dappPort(e.origin).deliver(e));
  });

  // The extension opens a window for each approval; the app shows them in the main window one after another.
  const approvalQueue = [];
  // After approval the user returns to where the request came from, for example Swap.
  let returnTab = null;
  const showApproval = () => {
    if (window.appLocked?.()) return;     // waits for the password, then resumeApproval starts it
    returnTab ??= window.currentTab?.() ?? null;
    window.showTab('wallet');
    approval(approvalQueue[0]);
  };
  window.approvalActive = () => approvalQueue.length > 0;
  window.resumeApproval = () => { if (approvalQueue.length) showApproval(); };
  window.onApprovalDone = () => {
    approvalQueue.shift();
    if (approvalQueue.length) { showApproval(); return; }
    start();
    if (returnTab && returnTab !== 'wallet') window.showTab(returnTab);
    returnTab = null;
  };

  window.importScripts = () => {};
  window.chrome = {
    runtime: {
      id: 'aether-desktop',
      lastError: undefined,
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      onConnect: { addListener: (fn) => listeners.connect.push(fn) },
      sendMessage(msg, reply) { ready.then(() => listeners.message.forEach((fn) => fn(msg, SENDER, reply))); },
    },
    storage: {
      local: {
        get: async (k) => { await ready; return pick(localData, k); },
        set: async (o) => { await ready; Object.assign(localData, o); await persist(); },
        clear: async () => { localData = {}; await persist(); },
      },
      session: {
        setAccessLevel() {},
        get: async (k) => pick(sessionData, k),
        set: async (o) => { Object.assign(sessionData, o); },
        remove: async (k) => { for (const x of [k].flat()) delete sessionData[x]; },
        clear: async () => { for (const x of Object.keys(sessionData)) delete sessionData[x]; },
      },
    },
    alarms: {
      create(name, { delayInMinutes }) {
        clearTimeout(timers[name]);
        timers[name] = setTimeout(() => listeners.alarm.forEach((fn) => fn({ name })), delayInMinutes * 60000);
      },
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    },
    windows: {
      create({ url }) {
        approvalQueue.push(Number(/approval=(\d+)/.exec(url)[1]));
        window.desktop.focusWallet();
        if (approvalQueue.length === 1) showApproval();
      },
      onRemoved: { addListener() {} },
    },
  };
})();
