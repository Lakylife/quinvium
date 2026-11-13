// Druhy transakcí v historii peněženky: každý podpis funkce musí existovat v kontraktech sítě, jinak by popis lhal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const artifacts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'contracts', 'dist', 'artifacts.json'), 'utf8'));
const type = (i) => (i.type.startsWith('tuple') ? `(${i.components.map(type).join(',')})${i.type.slice(5)}` : i.type);
const signatures = new Set(Object.values(artifacts).flatMap((c) => (c.abi ?? []).filter((f) => f.type === 'function').map((f) => `${f.name}(${f.inputs.map(type).join(',')})`)));

test('každý podpis v druzích transakcí patří skutečné funkci kontraktu', () => {
  const block = popup.slice(popup.indexOf('const CALL_KINDS'), popup.indexOf('];', popup.indexOf('const CALL_KINDS')));
  const used = [...block.matchAll(/\['([^']+\([^']*\))', '(\w+)'\]/g)].map((m) => m[1]);
  assert.ok(used.length >= 10, 'seznam se našel');
  assert.deepEqual(used.filter((s) => !signatures.has(s)), []);
});
