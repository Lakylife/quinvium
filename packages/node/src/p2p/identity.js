// Trvalá identita uzlu: klíč Ed25519 uložený ve složce dat. Identifikátor uzlu je otisk veřejného klíče,
// takže ho nikdo nemůže převzít, a podpis v HELLO váže klíč ke konkrétnímu šifrovanému spojení.
// Ed25519 umí OpenSSL i BoringSSL v Electronu (stejný algoritmus podepisuje aktualizace).
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const CONTEXT = Buffer.from('quintium-hello-v1');
export const ID_LEN = 16;
export const PUB_LEN = 32;
export const SIG_LEN = 64;

export class NodeIdentity {
  constructor(privateKey) {
    this.privateKey = privateKey;
    this.publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-PUB_LEN);
    this.id = nodeIdOf(this.publicKey);
  }

  /** Klíč ze souboru, nebo nový uložený s právy jen pro vlastníka. Bez souboru (testy) vznikne klíč jen pro tento běh. */
  static load(file) {
    if (!file) return new NodeIdentity(crypto.generateKeyPairSync('ed25519').privateKey);
    if (existsSync(file)) return new NodeIdentity(crypto.createPrivateKey(readFileSync(file)));
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    return new NodeIdentity(privateKey);
  }

  /** @param {Buffer} transcript otisk spojení @param {boolean} initiator role podepisujícího */
  sign(transcript, initiator) {
    return crypto.sign(null, message(transcript, initiator), this.privateKey);
  }
}

export const nodeIdOf = (publicKey) => crypto.createHash('sha256').update(publicKey).digest().subarray(0, ID_LEN);

const message = (transcript, initiator) => Buffer.concat([CONTEXT, Buffer.from([initiator ? 1 : 0]), transcript]);

/** Ověří podpis protistrany. Role je její, takže podpis nejde odrazit zpět ke stejnému uzlu. */
export function verifyHello(publicKey, signature, transcript, initiator) {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== PUB_LEN) return false;
  if (!(signature instanceof Uint8Array) || signature.length !== SIG_LEN) return false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]), format: 'der', type: 'spki' });
    return crypto.verify(null, message(transcript, initiator), key, signature);
  } catch {
    return false;
  }
}

/** Seed s připnutým klíčem: `klíč@host:port`, klíč jako 64 hex znaků. */
export function parsePinned(seed) {
  const m = /^([0-9a-fA-F]{64})@(.+)$/.exec(seed);
  return m ? { key: Buffer.from(m[1], 'hex'), address: m[2] } : { key: null, address: seed };
}
