// Peněženka je stejný kód jako rozšíření pro Chrome. Tahle vrstva mu nahrazuje rozhraní prohlížeče:
// šifrovaný trezor se ukládá do souboru aplikace, odemčená fráze jen do paměti okna.
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
  // Jen testy: zkušební aplikace má uzel na vlastním portu a peněženka se musí ptát jeho, ne skutečného uzlu.
  if (window.desktop.testRpcPort) self.AETHER_TEST_RPC = `http://127.0.0.1:${window.desktop.testRpcPort}`;

  // Okno Exploreru mluví s peněženkou stejně jako stránka s rozšířením, místo portu prohlížeče jde přes hlavní proces.
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

  // Rozšíření otevírá na každé schválení okno, aplikace je ukazuje v hlavním okně jedno po druhém.
  const approvalQueue = [];
  // Po schválení se uživatel vrátí tam, odkud žádost přišla, třeba do Swapu.
  let returnTab = null;
  const showApproval = () => {
    if (window.appLocked?.()) return;     // počká na heslo, pak ji spustí resumeApproval
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
