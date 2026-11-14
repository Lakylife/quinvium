#!/usr/bin/env node
// Test bridge Quinvium testnet ↔ Ethereum Sepolia: gateways on both networks, qETH backed by locked Sepolia ETH,
// routes in both directions, gas for the validators and their configuration. Testnet only: three validators on one computer
// are not independent; the bridge is for trying things out.
//
// The administrator, guardian and validator keys are in a private folder of the operator (mode 600). The script never prints them.
// Progress is saved to nasazeni.json, so an interrupted deployment continues where it stopped.
// Usage: node scripts/nasadit-most.mjs [Quinvium RPC] [Sepolia RPC]
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const [qRpc = 'http://127.0.0.1:8546', sRpc = 'https://ethereum-sepolia-rpc.publicnode.com'] = process.argv.slice(2);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(homedir(), '.aether', 'most-testnet');
const artifacts = JSON.parse(readFileSync(join(root, 'packages/contracts/dist/artifacts.json')));
// The deployment test writes to its own copy; the real Explorer file does not change.
const output = process.env.MOST_DEPLOYMENTS ?? join(root, 'packages/explorer/public/deployments.json');
const statePath = join(dir, 'nasazeni.json');
const QU = 52402n;
const SEPOLIA = 11155111n;
const VALIDATORS = ['validator-1', 'validator-2', 'validator-3'];
const THRESHOLD = 2;
const CONFIRMATIONS = 12;                     // about 3 minutes on Quinvium, 2.5 minutes on Sepolia
const ETH = (v) => ethers.parseEther(v);
const DAILY = ETH('5');                       // daily cap of the route
const LARGE = ETH('1');                       // a larger transfer waits 24 hours and the guardian can stop it
const MIN = ETH('0.001');                     // smallest transfer
const GAS_QU = ETH('0.05');                   // gas for each validator on Quinvium
const GAS_SEPOLIA = ETH('0.005');             // and on Sepolia, where gas is almost free

const key = (name) => {
  const file = join(dir, `${name}.key`);
  if (statSync(file).mode & 0o077) throw new Error(`${file} smí číst jen vlastník (chmod 600)`);
  return readFileSync(file, 'utf8').trim();
};
const quintium = new ethers.JsonRpcProvider(qRpc, undefined, { staticNetwork: true, cacheTimeout: -1 });
const sepolia = new ethers.JsonRpcProvider(sRpc, undefined, { staticNetwork: true, cacheTimeout: -1 });
if ((await quintium.getNetwork()).chainId !== QU) throw new Error(`${qRpc} není testnet Quinvia`);
if ((await sepolia.getNetwork()).chainId !== SEPOLIA) throw new Error(`${sRpc} není Sepolia`);

const adminQ = new ethers.Wallet(key('spravce'), quintium);
const adminS = new ethers.Wallet(key('spravce'), sepolia);
const guardian = new ethers.Wallet(key('strazce')).address;
const validators = VALIDATORS.map((name) => new ethers.Wallet(key(name)).address);
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const save = () => writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
const done = async (tx) => {
  const receipt = await (await tx).wait();
  if (receipt.status !== 1) throw new Error(`transakce ${receipt.hash} selhala`);
  return receipt;
};
async function deploy(wallet, name, ...args) {
  const contract = await new ethers.ContractFactory(artifacts[name].abi, artifacts[name].bytecode, wallet).deploy(...args);
  await contract.waitForDeployment();
  return contract.target;
}

const [haveQ, haveS] = await Promise.all([quintium.getBalance(adminQ.address), sepolia.getBalance(adminS.address)]);
console.log(`Správce ${adminQ.address}: ${ethers.formatEther(haveQ)} tQU, ${ethers.formatEther(haveS)} Sepolia ETH`);
const needQ = GAS_QU * BigInt(VALIDATORS.length) + ETH('0.05');
const needS = GAS_SEPOLIA * BigInt(VALIDATORS.length) + ETH('0.005');
if (!state.funded && (haveQ < needQ || haveS < needS)) {
  throw new Error(`Na adrese správce chybí plyn: potřeba aspoň ${ethers.formatEther(needQ)} tQU a ${ethers.formatEther(needS)} Sepolia ETH`);
}

if (!state.gatewayQ) {
  state.startQ = await quintium.getBlockNumber();
  state.gatewayQ = await deploy(adminQ, 'BridgeGateway', adminQ.address, guardian, validators, THRESHOLD);
  save();
}
console.log(`Brána na Quinviu: ${state.gatewayQ}`);
if (!state.gatewayS) {
  state.startS = await sepolia.getBlockNumber();
  state.gatewayS = await deploy(adminS, 'BridgeGateway', adminS.address, guardian, validators, THRESHOLD);
  save();
}
console.log(`Brána na Sepolii: ${state.gatewayS}`);
const gateQ = new ethers.Contract(state.gatewayQ, artifacts.BridgeGateway.abi, adminQ);
const gateS = new ethers.Contract(state.gatewayS, artifacts.BridgeGateway.abi, adminS);

// qETH on Quinvium is created only by delivery from Sepolia and burned on the way back. createWrapped creates the route from Sepolia.
if (!state.qETH) {
  const receipt = await done(gateQ.createWrapped('Ether (Sepolia)', 'qETH', 18, SEPOLIA, ethers.ZeroHash, DAILY, LARGE));
  const created = receipt.logs.map((l) => { try { return gateQ.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'WrappedCreated');
  state.qETH = created.args.token;
  save();
}
console.log(`qETH: ${state.qETH}`);
if (!state.routes) {
  await done(gateS.setOutbound(ethers.ZeroAddress, QU, true, false, MIN));        // Sepolia ETH se uzamkne
  await done(gateQ.setOutbound(state.qETH, SEPOLIA, true, true, MIN));            // qETH is burned
  await done(gateS.setRoute(QU, ethers.zeroPadValue(state.qETH, 32), ethers.ZeroAddress, false, true, DAILY, LARGE));
  state.routes = true;
  save();
}
console.log('Trasy ETH ↔ qETH jsou otevřené.');

for (const [i, address] of validators.entries()) {
  if (await quintium.getBalance(address) < GAS_QU / 2n) await done(adminQ.sendTransaction({ to: address, value: GAS_QU }));
  if (await sepolia.getBalance(address) < GAS_SEPOLIA / 2n) await done(adminS.sendTransaction({ to: address, value: GAS_SEPOLIA }));
  const config = {
    keyFile: `${VALIDATORS[i]}.key`, stateFile: `${VALIDATORS[i]}-stav.json`, pollMs: 15000,
    chains: [
      { id: Number(QU), name: 'Quinvium Testnet', rpc: qRpc, gateway: state.gatewayQ, confirmations: CONFIRMATIONS, startBlock: state.startQ },
      { id: Number(SEPOLIA), name: 'Sepolia', rpc: sRpc, gateway: state.gatewayS, confirmations: CONFIRMATIONS, startBlock: state.startS },
    ],
  };
  writeFileSync(join(dir, `${VALIDATORS[i]}.json`), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
state.funded = true;
save();
console.log(`Validátoři mají plyn a nastavení v ${dir}.`);

// Explorer: gateway address, Sepolia as the second network and the ETH route.
const all = JSON.parse(readFileSync(output, 'utf8'));
const here = all[QU.toString()] ?? {};
here.gateway = state.gatewayQ;
here.networks = [{ id: Number(SEPOLIA), name: 'Sepolia', rpc: sRpc, gateway: state.gatewayS, currency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 } }];
here.assets = [{ symbol: 'ETH', token: state.qETH, burn: true, decimals: 18, network: Number(SEPOLIA), min: MIN.toString(), remoteToken: ethers.ZeroAddress }];
all[QU.toString()] = here;
writeFileSync(output, `${JSON.stringify(all, null, 2)}\n`);
console.log(`Zapsáno do ${output}.`);
quintium.destroy();
sepolia.destroy();
