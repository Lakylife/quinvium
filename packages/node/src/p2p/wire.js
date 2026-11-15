// Transport layer between nodes: TCP, X25519 key exchange and AES-256-GCM frames.
// Each connection has its own keys, so traffic cannot be read or subtly modified on the way. Against an attacker who would
// relayed connections between two nodes, the signature with the node's persistent key in HELLO protects (see identity.js): what is signed is
// hash of both ephemeral keys, and an attacker has different ones with each side.
// The cipher must exist in both OpenSSL and BoringSSL: the node in the desktop app runs on Electron's Node, which lacks ChaCha20.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

export const MSG = Object.freeze({
  HELLO: 0, PING: 1, PONG: 2, GET_HEADERS: 3, HEADERS: 4, GET_BLOCKS: 5, BLOCKS: 6,
  NEW_BLOCK: 7, NEW_TXS: 8, GET_PEERS: 9, PEERS: 10, STATUS: 11,
  // Announcement by hash. Sent only to peers that list the FEATURE_ANNOUNCE capability in HELLO.
  NEW_TX_HASHES: 12, GET_TXS: 13, TXS: 14, NEW_BLOCK_HASH: 15,
  // Signed addresses of public RPC nodes (watch/public-nodes.js). Sent only to peers with FEATURE_PUBLIC_NODES.
  PUBLIC_NODES: 16,
});

export const MAX_FRAME = 12 * 1024 * 1024;
export const MAX_QUEUED = 32 * 1024 * 1024;   // a peer that does not read must not fill our memory
const MAX_HELLO_FRAME = 16 * 1024;
const PUB_LEN = 32;
const TAG_LEN = 16;
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const SALT = Buffer.from('aether-p2p-v1');
const CIPHER = 'aes-256-gcm';

export class SecureChannel extends EventEmitter {
  /**
   * @param {import('node:net').Socket} socket
   * @param {boolean} initiator true for an outbound connection
   */
  constructor(socket, initiator) {
    super();
    this.socket = socket;
    this.initiator = initiator;
    this.chunks = [];
    this.have = 0;
    this.maxFrame = MAX_HELLO_FRAME;  // nothing large is expected before the handshake
    this.sendCounter = 0n;
    this.recvCounter = 0n;
    this.sendKey = null;
    this.recvKey = null;
    this.closed = false;
    const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
    this.privateKey = privateKey;
    this.localPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-PUB_LEN);
    this.remotePub = null;
    socket.setNoDelay(true);
    socket.write(this.localPub);
    socket.on('data', (d) => this._onData(d));
    socket.on('error', (e) => this.close(e.message));
    socket.on('close', () => this.close('spojení ukončeno'));
  }

  /** Allows large frames after the handshake is complete. */
  unlock() { this.maxFrame = MAX_FRAME; }

  /** Connection fingerprint: both ephemeral keys in initiator, responder order. For an attacker in the middle it differs on each side. */
  transcript() {
    const [a, b] = this.initiator ? [this.localPub, this.remotePub] : [this.remotePub, this.localPub];
    return crypto.createHash('sha256').update(SALT).update(a).update(b).digest();
  }

  _deriveKeys(peerRaw) {
    this.remotePub = Buffer.from(peerRaw);
    const peerKey = crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, peerRaw]), format: 'der', type: 'spki' });
    const secret = crypto.diffieHellman({ privateKey: this.privateKey, publicKey: peerKey });
    const okm = Buffer.from(crypto.hkdfSync('sha256', secret, SALT, 'keys', 64));
    const [a, b] = [okm.subarray(0, 32), okm.subarray(32)];
    this.sendKey = this.initiator ? a : b;
    this.recvKey = this.initiator ? b : a;
    this.privateKey = null;
    this.emit('ready');
  }

  static _nonce(counter) {
    const n = Buffer.alloc(12);
    n.writeBigUInt64BE(counter, 4);
    return n;
  }

  /** Pieces are joined once the whole frame is there, not on every incoming packet. */
  _flat(n) {
    if (this.chunks[0].length < n) this.chunks = [Buffer.concat(this.chunks)];
    return this.chunks[0];
  }

  _take(n) {
    const head = this._flat(n);
    const out = head.subarray(0, n);
    if (head.length === n) this.chunks.shift();
    else this.chunks[0] = head.subarray(n);
    this.have -= n;
    return out;
  }

  _onData(chunk) {
    this.chunks.push(chunk);
    this.have += chunk.length;
    try {
      if (!this.recvKey) {
        if (this.have < PUB_LEN) return;
        this._deriveKeys(this._take(PUB_LEN));
      }
      for (;;) {
        if (this.have < 4) return;
        const len = this._flat(4).readUInt32BE(0);
        if (len < TAG_LEN + 1 || len > this.maxFrame + 1 + TAG_LEN) throw new Error('neplatná délka rámce');
        if (this.have < 4 + len) return;
        this._take(4);
        const frame = this._take(len);
        const decipher = crypto.createDecipheriv(CIPHER, this.recvKey, SecureChannel._nonce(this.recvCounter++), { authTagLength: TAG_LEN });
        decipher.setAuthTag(frame.subarray(len - TAG_LEN));
        const plain = Buffer.concat([decipher.update(frame.subarray(0, len - TAG_LEN)), decipher.final()]);
        this.emit('frame', plain[0], new Uint8Array(plain.subarray(1)));
        if (this.closed) return;
      }
    } catch (e) {
      this.close(`chyba protokolu: ${e.message}`);
    }
  }

  /** Bytes waiting to be sent: a peer that does not read is recognised by their growth. */
  get queued() { return this.socket.writableLength; }

  send(type, payload) {
    if (this.closed || !this.sendKey) return false;
    const plain = Buffer.concat([Buffer.from([type]), payload]);
    if (plain.length > MAX_FRAME) throw new Error('zpráva je příliš velká');
    if (this.queued + plain.length > MAX_QUEUED) {
      this.close('uzel nečte data');
      return false;
    }
    const cipher = crypto.createCipheriv(CIPHER, this.sendKey, SecureChannel._nonce(this.sendCounter++), { authTagLength: TAG_LEN });
    const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    return this.socket.write(Buffer.concat([head, body]));
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.chunks = [];
    this.have = 0;
    this.emit('close', reason);
  }
}
