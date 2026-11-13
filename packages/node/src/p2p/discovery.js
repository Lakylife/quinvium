// Hledání uzlů v místní síti. Veřejná síť spoléhá na seed uzly, doma se počítače najdou samy:
// uzel občas ohlásí svůj port všesměrovým UDP a kdo ho slyší, odpoví přímo jemu.
// Zpráva nic nedokazuje. Skutečné ověření proběhne při spojení a u každého bloku.
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { L } from '../lang.js';

export const DISCOVERY_PORT = 30529;
const INTERVAL_MS = 10_000;
const MAX_MESSAGE = 160;
const PATTERN = /^aether-lan1 (\d{1,12}) ([0-9a-f]{64}) (\d{1,5}) ([0-9a-f]{32}) (ask|reply)$/;

/** Poslední adresa rozsahu, na ni naslouchají všichni v dané síti. */
export function broadcastAddress(address, netmask) {
  const mask = netmask.split('.').map(Number);
  return address.split('.').map((b, i) => Number(b) | (~mask[i] & 255)).join('.');
}

/** @returns {[string, number][]} kam se ohlásit na všech připojených síťových rozhraních */
function broadcastTargets(port) {
  const hosts = new Set(['255.255.255.255']);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) hosts.add(broadcastAddress(a.address, a.netmask));
  }
  return [...hosts].map((host) => [host, port]);
}

export class LanDiscovery {
  /**
   * @param {object} o
   * @param {bigint|number} o.chainId
   * @param {string} o.genesis hash genesis bloku hexadecimálně
   * @param {number} o.port port pro spojení mezi uzly
   * @param {string} o.nodeId identita uzlu hexadecimálně
   * @param {(ip: string) => boolean} o.accepts které adresy patří do místní sítě
   * @param {(ip: string, port: number, nodeId: string) => void} o.onPeer
   */
  constructor({ chainId, genesis, port, nodeId, accepts, onPeer, listenPort = DISCOVERY_PORT, targets = () => broadcastTargets(listenPort), log = () => {} }) {
    Object.assign(this, { chainId: String(chainId), genesis, port, nodeId, accepts, onPeer, listenPort, targets, log });
    this.socket = null;
    this.timer = null;
  }

  _message(kind) {
    return Buffer.from(`aether-lan1 ${this.chainId} ${this.genesis} ${this.port} ${this.nodeId} ${kind}`);
  }

  _send(message, host, port) {
    this.socket?.send(message, port, host, () => { /* síť bez spojení není chyba */ });
  }

  _announce() {
    for (const [host, port] of this.targets()) this._send(this._message('ask'), host, port);
  }

  _onMessage(data, from) {
    if (data.length > MAX_MESSAGE || !this.accepts(from.address)) return;
    const m = PATTERN.exec(data.toString('latin1'));
    if (!m) return;
    const [, chainId, genesis, port, nodeId, kind] = m;
    const peerPort = Number(port);
    if (chainId !== this.chainId || genesis !== this.genesis || nodeId === this.nodeId || peerPort < 1 || peerPort > 65535) return;
    this.onPeer(from.address, peerPort, nodeId);
    // Odpověď přímo odesílateli projde i přes bránu počítače, která všesměrové zprávy zvenčí blokuje.
    if (kind === 'ask') this._send(this._message('reply'), from.address, from.port);
  }

  async start() {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(this.listenPort, () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });
    socket.on('error', (e) => this.log(`${L('Hledání v místní síti', 'Local network discovery')}: ${e.message}`));
    socket.on('message', (data, from) => this._onMessage(data, from));
    socket.setBroadcast(true);
    this.socket = socket;
    this._announce();
    this.timer = setInterval(() => this._announce(), INTERVAL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.socket?.close();
    this.socket = null;
  }
}
