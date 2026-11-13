// Přístup z internetu: router otevře porty přes UPnP, uzel zná svou veřejnou adresu a ukáže ji peněženkám.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AetherNode } from '../src/node.js';
import { NETWORKS } from '../src/params.js';
import { IP_LOOKUP, PublicAccess, isLocalCaller, isPublicIPv4, parseDescription, readText } from '../src/p2p/upnp.js';
import { POW_DIR, tmpData } from './helpers/chain.js';

const SERVICE = 'urn:schemas-upnp-org:service:WANIPConnection:1';
const description = (control) => `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><serviceList>
  <service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/l3f</controlURL></service>
  <service><serviceType>${SERVICE}</serviceType><controlURL>${control}</controlURL></service></serviceList></device></root>`;

/** Zkušební router: popis zařízení a řízení přesměrování, jak je posílají běžné domácí routery. */
async function fakeRouter({ externalIp = '203.0.113.7', permanentOnly = false, control = '/ctl' } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.url === '/desc.xml') { res.end(description(control)); return; }
      const action = /#(\w+)"/.exec(req.headers.soapaction ?? '')?.[1];
      calls.push({ action, body });
      if (action === 'AddPortMapping' && permanentOnly && !/<NewLeaseDuration>0</.test(body)) {
        res.writeHead(500);
        res.end('<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>725</errorCode><errorDescription>OnlyPermanentLeasesSupported</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>');
        return;
      }
      const out = action === 'GetExternalIPAddress' ? `<NewExternalIPAddress>${externalIp}</NewExternalIPAddress>` : '';
      res.end(`<s:Envelope><s:Body><u:${action}Response xmlns:u="${SERVICE}">${out}</u:${action}Response></s:Body></s:Envelope>`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const location = `http://127.0.0.1:${server.address().port}/desc.xml`;
  return { calls, location, close: () => new Promise((r) => server.close(r)) };
}

const noLookup = (impl = globalThis.fetch) => (url, init) => (String(url) === IP_LOOKUP ? Promise.reject(new Error('bez internetu')) : impl(url, init));

test('veřejná adresa: soukromé a sdílené adresy operátora mezi ně nepatří', () => {
  for (const ip of ['203.0.113.7', '8.8.8.8', '81.2.69.160']) assert.ok(isPublicIPv4(ip), ip);
  for (const ip of ['192.168.1.1', '10.0.0.2', '172.20.1.1', '100.64.3.4', '127.0.0.1', '169.254.1.1', 'nesmysl', '', null, '::1']) assert.ok(!isPublicIPv4(ip), String(ip));
});

test('popis routeru: vybere službu pro přesměrování a odmítne řízení na jiném počítači', () => {
  const g = parseDescription(description('/ctl'), 'http://192.168.1.1:5000/desc.xml');
  assert.deepEqual(g, { service: SERVICE, control: 'http://192.168.1.1:5000/ctl', host: '192.168.1.1' });
  assert.equal(parseDescription(description('http://10.9.9.9/ctl'), 'http://192.168.1.1:5000/desc.xml'), null);
  assert.equal(parseDescription('<root></root>', 'http://192.168.1.1/'), null);
});

test('router otevře porty, prozradí veřejnou adresu a po skončení porty zase zavře', async () => {
  const router = await fakeRouter();
  try {
    const access = new PublicAccess({ ports: [{ port: 8546, name: 'RPC' }, { port: 30525, name: 'P2P' }], discover: async () => router.location, localAddress: async () => '192.168.1.50', fetch: noLookup() });
    const s = await access.start();
    assert.equal(s.host, '203.0.113.7');
    assert.equal(s.method, 'upnp');
    assert.equal(s.upnp, true);
    assert.equal(s.internal, '192.168.1.50');
    const maps = router.calls.filter((c) => c.action === 'AddPortMapping');
    assert.equal(maps.length, 2);
    assert.match(maps[0].body, /<NewExternalPort>8546<\/NewExternalPort>.*<NewInternalClient>192\.168\.1\.50</s);
    await access.stop();
    assert.equal(router.calls.filter((c) => c.action === 'DeletePortMapping').length, 2);
  } finally {
    await router.close();
  }
});

test('router s trvalým přesměrováním a router za sdílenou adresou operátora', async () => {
  const permanent = await fakeRouter({ permanentOnly: true });
  const cgnat = await fakeRouter({ externalIp: '100.72.1.9' });
  try {
    const a = new PublicAccess({ ports: [{ port: 8546, name: 'RPC' }], discover: async () => permanent.location, localAddress: async () => '192.168.1.50', fetch: noLookup() });
    assert.equal((await a.refresh()).host, '203.0.113.7');
    assert.ok(permanent.calls.some((c) => c.action === 'AddPortMapping' && /<NewLeaseDuration>0</.test(c.body)));
    let looked = false;
    const b = new PublicAccess({ ports: [{ port: 8546, name: 'RPC' }], discover: async () => cgnat.location, localAddress: async () => '192.168.1.50', fetch: (url, init) => { if (String(url) === IP_LOOKUP) looked = true; return fetch(url, init); } });
    const s = await b.refresh();
    assert.equal(s.behindNat, true, 'adresa 100.64/10 není z internetu dostupná');
    assert.equal(s.host, null);
    assert.equal(looked, false, 'za sdílenou adresou nemá smysl se ptát služby na internetu');
  } finally {
    await permanent.close();
    await cgnat.close();
  }
});

test('bez UPnP zjistí veřejnou adresu službou na internetu, ruční adresa má přednost', async () => {
  const lookup = async (url) => { assert.equal(String(url), IP_LOOKUP); return new Response('198.51.100.20\n'); };
  const a = new PublicAccess({ ports: [{ port: 8546, name: 'RPC' }], discover: async () => null, fetch: lookup });
  const s = await a.refresh();
  assert.equal(s.host, '198.51.100.20');
  assert.equal(s.method, 'lookup');
  assert.equal(s.upnp, false);
  assert.match(s.error, /UPnP/);
  const bad = new PublicAccess({ ports: [{ port: 8546, name: 'RPC' }], discover: async () => null, fetch: async () => new Response('<html>192.168.1.1</html>') });
  assert.equal((await bad.refresh()).host, null, 'nesmyslná odpověď se nepoužije');
  const manual = new PublicAccess({ ports: [{ port: 8546, name: 'RPC' }], host: 'uzel.example.cz', discover: async () => null, fetch: lookup });
  const m = await manual.refresh();
  assert.equal(m.host, 'uzel.example.cz');
  assert.equal(m.method, 'manual');
});

test('aether_endpoints: uzel vypíše RPC pro tento počítač, místní síť a internet', async () => {
  const dataDir = tmpData();
  const base = { network: NETWORKS.dev, dataDir, powDir: POW_DIR, p2pPort: 0, rpcPort: 0, stratumPort: 0, p2pHost: '127.0.0.1', allowPrivate: true, log: () => {} };
  const local = await new AetherNode(base).start();
  try {
    const e = local.endpoints();
    assert.equal(e.local, `http://127.0.0.1:${local.rpc.port}`);
    assert.deepEqual(e.lan, [], 'bez sdílení RPC slyší jen na tomto počítači');
    assert.equal(e.public, null);
  } finally {
    await local.stop();
  }
  const shared = await new AetherNode({
    ...base, rpcHost: '0.0.0.0', publicAccess: true, publicHost: '203.0.113.7',
    publicAccessOptions: { discover: async () => null, fetch: noLookup() },
  }).start();
  try {
    await shared.publicAccess.refresh();
    const r = await fetch(`http://127.0.0.1:${shared.rpc.port}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'aether_endpoints', params: [] }) }).then((x) => x.json());
    assert.equal(r.result.public, `http://203.0.113.7:${shared.rpc.port}`);
    assert.equal(r.result.chainId, Number(NETWORKS.dev.chainId));
    assert.equal(r.result.access.method, 'manual');
    assert.equal(r.result.access.upnp, false);
    for (const url of r.result.lan) assert.match(url, new RegExp(`^http://(10|172|192|100)\\.[\\d.]+:${shared.rpc.port}$`));
    // Volající z internetu (tady požadavek s hlavičkou proxy) nevidí místní adresy a nedostane práci pro těžbu.
    const far = (method, params = []) => fetch(`http://127.0.0.1:${shared.rpc.port}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.9' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((x) => x.json());
    const f = await far('aether_endpoints');
    assert.equal(f.result.restricted, true);
    assert.deepEqual(f.result.lan, []);
    assert.equal(f.result.local, null);
    assert.equal(f.result.access.internal, undefined);
    assert.equal(f.result.public, `http://203.0.113.7:${shared.rpc.port}`);
    for (const m of ['eth_getWork', 'aether_getWork', 'eth_submitWork', 'aether_submitWork', 'eth_submitHashrate']) {
      assert.match((await far(m, ['0x' + '11'.repeat(20)])).error?.message ?? '', /jen z místní sítě/, m);
    }
    assert.equal((await far('eth_chainId')).result, `0x${NETWORKS.dev.chainId.toString(16)}`, 'běžné dotazy fungují dál');
    const near = await fetch(`http://127.0.0.1:${shared.rpc.port}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_submitHashrate', params: ['0x1', '0x' + '00'.repeat(32)] }) }).then((x) => x.json());
    assert.equal(near.result, true, 'těžař z tohoto počítače pracuje dál');
  } finally {
    await shared.stop();
  }
});

test('router za dalším routerem: veřejná adresa je známá, ale bez přesměrování na modemu nedostupná', async () => {
  const inner = await fakeRouter({ externalIp: '192.168.0.10' });
  const cgnat = await fakeRouter({ externalIp: '100.72.1.9' });
  try {
    const a = new PublicAccess({ ports: [{ port: 8546, name: 'RPC' }], discover: async () => inner.location, localAddress: async () => '192.168.1.50', fetch: async (url, init) => (String(url) === IP_LOOKUP ? new Response('198.51.100.20') : fetch(url, init)) });
    const s = await a.refresh();
    assert.equal(s.upnp, true);
    assert.equal(s.behindNat, true);
    assert.equal(s.nat, 'double');
    assert.equal(s.host, '198.51.100.20', 'veřejnou adresu zjistí služba na internetu');
    assert.equal(s.method, 'lookup');
    const b = new PublicAccess({ ports: [{ port: 8546, name: 'RPC' }], discover: async () => cgnat.location, localAddress: async () => '192.168.1.50', fetch: noLookup() });
    assert.equal((await b.refresh()).nat, 'cgnat');
    const c = new PublicAccess({ ports: [{ port: 8546, name: 'RPC' }], discover: async () => null, fetch: async () => new Response('198.51.100.20') });
    assert.equal((await c.refresh()).nat, null, 'bez routeru se o překladu adres nic neví');
  } finally {
    await inner.close();
    await cgnat.close();
  }
});

test('isLocalCaller: místní je jen tento počítač a soukromá síť', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '192.168.1.235', '::ffff:10.0.0.5', '172.20.1.1', 'fe80::1', 'fd00::5']) assert.equal(isLocalCaller(ip), true, ip);
  for (const ip of ['203.0.113.7', '::ffff:8.8.8.8', '100.64.1.1', '2001:db8::1', '', undefined, 'nesmysl']) assert.equal(isLocalCaller(ip), false, String(ip));
});

test('odpověď routeru se čte s limitem', async () => {
  const big = new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(65536).fill(97)); } }));
  assert.equal((await readText(big, 1000)).length, 1000);
});
