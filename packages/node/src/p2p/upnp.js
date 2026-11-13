// Přístup k uzlu z internetu: router otevře porty přes UPnP a uzel zjistí svou veřejnou adresu.
// Bez UPnP zůstane jen veřejná adresa a návod na ruční přesměrování portů.
import dgram from 'node:dgram';
import { BlockList, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { L } from '../lang.js';

const SSDP_HOST = '239.255.255.250';
const SSDP_PORT = 1900;
const TARGETS = ['urn:schemas-upnp-org:device:InternetGatewayDevice:2', 'urn:schemas-upnp-org:device:InternetGatewayDevice:1'];
const SERVICES = ['urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1'];
const LEASE_S = 3600;
export const RENEW_MS = 20 * 60_000;
const REQUEST_MS = 4000;
const MAX_XML = 256 * 1024;
export const IP_LOOKUP = 'https://api.ipify.org';

const nonPublic = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) {
  nonPublic.addSubnet(net, prefix, 'ipv4');
}
/** Adresa, na kterou se dá připojit z internetu. Sdílená adresa operátora (100.64/10) mezi ně nepatří. */
export const isPublicIPv4 = (ip) => isIP(String(ip ?? '')) === 4 && !nonPublic.check(ip, 'ipv4');
const localV6 = new BlockList();
localV6.addAddress('::1', 'ipv6');
localV6.addSubnet('fe80::', 10, 'ipv6');
localV6.addSubnet('fc00::', 7, 'ipv6');
const localV4 = new BlockList();
for (const [net, prefix] of [['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]]) localV4.addSubnet(net, prefix, 'ipv4');
/**
 * Volající z tohoto počítače nebo z místní sítě. Sdílená adresa operátora (100.64/10) místní není: jsou za ní cizí lidé.
 * Neznámá adresa se bere jako cizí.
 */
export function isLocalCaller(ip) {
  let a = String(ip ?? '');
  if (a.toLowerCase().startsWith('::ffff:') && isIP(a.slice(7)) === 4) a = a.slice(7);
  const kind = isIP(a);
  if (kind === 4) return localV4.check(a, 'ipv4');
  if (kind === 6) return localV6.check(a, 'ipv6');
  return false;
}
const shared = new BlockList();
shared.addSubnet('100.64.0.0', 10, 'ipv4');
/** Druh překladu adres před routerem: 'cgnat' u sdílené adresy operátora, 'double' u dalšího routeru nebo modemu, jinak null. */
export const natKind = (ip) => (isIP(String(ip ?? '')) !== 4 || isPublicIPv4(ip) ? null : shared.check(ip, 'ipv4') ? 'cgnat' : 'double');

const xmlText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tag = (xml, name) => new RegExp(`<(?:[\\w-]+:)?${name}\\s*>([^<]*)</(?:[\\w-]+:)?${name}\\s*>`, 'i').exec(xml)?.[1]?.trim();

/**
 * Najde router v místní síti. Odpověď se bere jen tehdy, když popis zařízení leží na stejné adrese, ze které přišla.
 * Dotaz jde z každého síťového rozhraní zvlášť a dvakrát po sobě: počítač s kabelem i Wi-Fi by se jinak ptal jen jedním
 * z nich a ztracený paket UDP by znamenal, že router jakoby UPnP neuměl.
 */
export function discover({ timeout = 3000, addresses } = {}) {
  const locals = addresses ?? Object.values(networkInterfaces()).flat().filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')).map((a) => a.address);
  const binds = locals.length ? locals : [undefined];
  return new Promise((resolve) => {
    const socks = [];
    const timers = [];
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      for (const sock of socks) { try { sock.close(); } catch { /* už zavřený */ } }
      resolve(v);
    };
    timers.push(setTimeout(() => finish(null), timeout));
    for (const address of binds) {
      const sock = dgram.createSocket('udp4');
      socks.push(sock);
      sock.on('error', () => { try { sock.close(); } catch { /* už zavřený */ } });
      sock.on('message', (msg, rinfo) => {
        const location = /^location:\s*(\S+)/im.exec(msg.toString('latin1'))?.[1];
        if (!location) return;
        try {
          const u = new URL(location);
          if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname === rinfo.address) finish(u.href);
        } catch { /* neplatná adresa, čeká se na další odpověď */ }
      });
      const ask = () => {
        if (done) return;
        for (const st of TARGETS) {
          const m = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_HOST}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
          try { sock.send(m, SSDP_PORT, SSDP_HOST, () => {}); } catch { /* rozhraní mezitím zmizelo */ }
        }
      };
      sock.bind(0, address, () => {
        ask();
        timers.push(setTimeout(ask, Math.min(1000, timeout / 3)));
      });
    }
  });
}

/** Ze seznamu služeb routeru vybere tu, která umí přesměrovat porty. */
export function parseDescription(xml, location) {
  const base = tag(xml, 'URLBase') || location;
  for (const service of SERVICES) {
    for (const block of xml.match(/<(?:[\w-]+:)?service\s*>[\s\S]*?<\/(?:[\w-]+:)?service\s*>/gi) ?? []) {
      if (tag(block, 'serviceType') !== service) continue;
      const control = tag(block, 'controlURL');
      if (!control) continue;
      const url = new URL(control, base);
      // Řízení musí jít na tentýž router, ne na jiný počítač, který by si popis vymyslel.
      if (url.hostname !== new URL(location).hostname) continue;
      return { service, control: url.href, host: url.hostname };
    }
  }
  return null;
}

/** Odpověď se čte po kouscích a po dosažení limitu se spojení zahodí: cizí zařízení v síti nesmí zaplnit paměť uzlu. */
export async function readText(res, max = MAX_XML) {
  if (!res.body?.getReader) {
    const text = await res.text();
    return text.length > max ? text.slice(0, max) : text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = max - size;
    if (value.length >= room) {
      chunks.push(value.subarray(0, room));
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.length;
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function soap(gateway, action, args = {}, fetchImpl = globalThis.fetch) {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${gateway.service}">${Object.entries(args).map(([k, v]) => `<${k}>${xmlText(v)}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
  const res = await fetchImpl(gateway.control, {
    method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(REQUEST_MS),
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${gateway.service}#${action}"` },
  });
  const text = await readText(res);
  if (!res.ok) {
    const err = new Error(tag(text, 'errorDescription') || `HTTP ${res.status}`);
    err.code = Number(tag(text, 'errorCode')) || res.status;
    throw err;
  }
  return text;
}

/** Adresa tohoto počítače, přes kterou vede cesta k routeru. Tu router potřebuje jako cíl přesměrování. */
function localAddressTowards(host) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    sock.on('error', () => { sock.close(); resolve(null); });
    sock.connect(SSDP_PORT, host, () => {
      const { address } = sock.address();
      sock.close();
      resolve(address);
    });
  });
}

/**
 * Udržuje porty otevřené v routeru a zná veřejnou adresu uzlu.
 * `host` je ruční veřejná adresa nebo doména, `lookup` zjistí adresu přes službu na internetu, když ji router neprozradí.
 */
export class PublicAccess {
  constructor({ ports, host = null, lookup = true, log = () => {}, fetch: fetchImpl = globalThis.fetch, discover: find = discover, localAddress = localAddressTowards } = {}) {
    this.ports = ports.filter((p) => Number.isInteger(p.port) && p.port > 0);
    this.manualHost = host || null;
    this.lookup = lookup;
    this.log = log;
    this.fetch = fetchImpl;
    this.find = find;
    this.localAddress = localAddress;
    this.gateway = null;
    this.mapped = [];
    this.state = { host: this.manualHost, method: this.manualHost ? 'manual' : null, upnp: false, router: null, internal: null, behindNat: false, nat: null, error: null, ports: this.ports.map((p) => p.port), checked: null };
  }

  async start() {
    await this.refresh();
    this.timer = setInterval(() => this.refresh().catch(() => {}), RENEW_MS);
    this.timer.unref?.();
    return this.state;
  }

  async _gatewayFound() {
    if (this.gateway) return this.gateway;
    const location = await this.find();
    if (!location) return null;
    const res = await this.fetch(location, { redirect: 'error', signal: AbortSignal.timeout(REQUEST_MS) });
    if (!res.ok) return null;
    this.gateway = parseDescription(await readText(res), location);
    return this.gateway;
  }

  async _map(gateway, internal, p, lease) {
    await soap(gateway, 'AddPortMapping', {
      NewRemoteHost: '', NewExternalPort: p.port, NewProtocol: 'TCP', NewInternalPort: p.port, NewInternalClient: internal,
      NewEnabled: 1, NewPortMappingDescription: `Quinvium ${p.name}`, NewLeaseDuration: lease,
    }, this.fetch);
  }

  async refresh() {
    let routerIp = null;
    let error = null;
    try {
      const gateway = await this._gatewayFound();
      if (!gateway) throw new Error(L('router nepodporuje UPnP nebo ho má vypnuté', 'the router does not support UPnP or has it turned off'));
      const internal = await this.localAddress(gateway.host);
      if (!internal) throw new Error(L('nelze zjistit adresu tohoto počítače', 'cannot find the address of this computer'));
      this.state.internal = internal;
      this.state.router = gateway.host;
      const mapped = [];
      for (const p of this.ports) {
        try {
          await this._map(gateway, internal, p, LEASE_S);
        } catch (e) {
          if (e.code !== 725) throw e;
          await this._map(gateway, internal, p, 0);   // router umí jen trvalé přesměrování
        }
        mapped.push(p.port);
      }
      this.mapped = mapped;
      routerIp = tag(await soap(gateway, 'GetExternalIPAddress', {}, this.fetch), 'NewExternalIPAddress') ?? null;
      this.state.upnp = true;
    } catch (e) {
      this.gateway = null;
      this.state.upnp = false;
      error = e.message;
    }
    this.state.behindNat = !!routerIp && !isPublicIPv4(routerIp);
    // Za dalším routerem má síť veřejnou adresu, jen se k ní nedá připojit, dokud ten router porty nepřesměruje. Za CGNAT veřejná adresa není.
    this.state.nat = routerIp ? natKind(routerIp) : null;
    let host = this.manualHost;
    let method = host ? 'manual' : null;
    if (!host && routerIp && isPublicIPv4(routerIp)) { host = routerIp; method = 'upnp'; }
    // Adresu z routeru může podvrhnout jiné zařízení v místní síti, proto se porovná s tím, co vidí internet.
    if (method !== 'manual' && this.lookup && this.state.nat !== 'cgnat') {
      try {
        const res = await this.fetch(IP_LOOKUP, { redirect: 'error', signal: AbortSignal.timeout(REQUEST_MS) });
        const ip = (await readText(res, 64)).trim();
        if (res.ok && isPublicIPv4(ip)) {
          if (host && host !== ip && this.state.mismatch !== ip) {
            this.state.mismatch = ip;
            this.log(L(`VAROVÁNÍ: router hlásí veřejnou adresu ${host}, z internetu je ale vidět ${ip}. Použije se ${ip}.`, `WARNING: the router reports the public address ${host}, but the internet sees ${ip}. Using ${ip}.`));
          }
          if (host !== ip) method = 'lookup';
          host = ip;
        }
      } catch { /* bez internetu zůstane adresa z routeru, případně neznámá */ }
    }
    if (this.state.host !== host && host) {
      const rpc = this.ports.find((p) => p.name === 'RPC')?.port;
      const url = rpc ? `http://${host}:${rpc}` : host;
      const reach = this.state.nat === 'double' ? L(', funguje až po přesměrování portů na modemu', ', works only after forwarding the ports on the modem') : this.state.upnp ? L(', porty otevřené v routeru', ', ports opened in the router') : this.manualHost ? '' : L(`, funguje až po ručním přesměrování TCP portu ${rpc ?? ''} v routeru na tento počítač`, `, works only after forwarding TCP port ${rpc ?? ''} in the router to this computer`);
      this.log(L(`RPC pro peněženky z internetu: ${url}${reach}`, `RPC for wallets from the internet: ${url}${reach}`));
    }
    if (error && error !== this.state.error) this.log(L(`Automatické otevření portů selhalo: ${error}`, `Automatic port opening failed: ${error}`));
    Object.assign(this.state, { host, method, error, checked: Date.now() });
    return this.state;
  }

  info() {
    return { ...this.state, ports: [...this.state.ports] };
  }

  async stop() {
    clearInterval(this.timer);
    const gateway = this.gateway;
    if (!gateway) return;
    await Promise.all(this.mapped.map((port) => soap(gateway, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' }, this.fetch).catch(() => {})));
    this.mapped = [];
  }
}
