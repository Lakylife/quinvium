// Persistent node identity: an Ed25519 key stored in the data folder. The node ID is a hash of the public key,
// so nobody can take it over, and the signature in HELLO binds the key to a specific encrypted connection.
// Ed25519 is supported by both OpenSSL and the BoringSSL in Electron (the same algorithm signs updates).
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

  /** Key from a file, or a new one saved with owner-only permissions. Without a file (tests) a key is created for this run only. */
  static load(file) {
    if (!file) return new NodeIdentity(crypto.generateKeyPairSync('ed25519').privateKey);
    if (existsSync(file)) return new NodeIdentity(crypto.createPrivateKey(readFileSync(file)));
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    return new NodeIdentity(privateKey);
  }

  /** @param {Buffer} transcript connection fingerprint @param {boolean} initiator role of the signer */
  sign(transcript, initiator) {
    return crypto.sign(null, message(transcript, initiator), this.privateKey);
  }
}

export const nodeIdOf = (publicKey) => crypto.createHash('sha256').update(publicKey).digest().subarray(0, ID_LEN);

const message = (transcript, initiator) => Buffer.concat([CONTEXT, Buffer.from([initiator ? 1 : 0]), transcript]);

/** Verifies the other side's signature. The role is theirs, so the signature cannot be reflected back to the same node. */
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

/** A seed with a pinned key: `key@host:port`, the key as 64 hex characters. */
export function parsePinned(seed) {
  const m = /^([0-9a-fA-F]{64})@(.+)$/.exec(seed);
  return m ? { key: Buffer.from(m[1], 'hex'), address: m[2] } : { key: null, address: seed };
}
