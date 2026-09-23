// File format (all integers big-endian):
//   header: "NASENC01" (8) | chunkSize u32 (4) | masterSalt (16) | fileSalt (16) | baseNonce (8)  = 52 bytes
//   then one AES-256-GCM block per plaintext chunk: ciphertext || 16-byte tag.
// Nonce = baseNonce || chunkIndex u32. The final chunk is authenticated with AAD [1],
// all others with [0], so truncating the file makes decryption fail.

const MAGIC = new TextEncoder().encode('NASENC01');
export const HEADER_LEN = 52;
export const ENC_CHUNK = 8 * 1024 * 1024;
const TAG_LEN = 16;
const PBKDF2_ITERATIONS = 600_000;

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong encryption passphrase, or the file is damaged.');
  }
}

function random(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function chunkCount(plainSize: number): number {
  return Math.max(1, Math.ceil(plainSize / ENC_CHUNK));
}

export function encryptedSize(plainSize: number): number {
  return HEADER_LEN + plainSize + chunkCount(plainSize) * TAG_LEN;
}

export function plainSizeOf(encSize: number, chunkSize = ENC_CHUNK): number {
  const body = encSize - HEADER_LEN;
  const chunks = Math.max(1, Math.ceil(body / (chunkSize + TAG_LEN)));
  return body - chunks * TAG_LEN;
}

// Holds the passphrase for this tab only; derived master keys are cached per salt
// so PBKDF2 runs once per session instead of once per file.
export class EncryptionSession {
  readonly masterSalt = random(16);
  private cache = new Map<string, Promise<CryptoKey>>();

  constructor(private passphrase: string) {}

  masterKey(salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const id = hex(salt);
    let key = this.cache.get(id);
    if (!key) {
      key = (async () => {
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.passphrase), 'PBKDF2', false, [
          'deriveBits',
        ]);
        const bits = await crypto.subtle.deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
          material,
          256,
        );
        return crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
      })();
      this.cache.set(id, key);
    }
    return key;
  }

  async fileKey(masterSalt: Uint8Array<ArrayBuffer>, fileSalt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: fileSalt, info: new TextEncoder().encode('local-nas file v1') },
      await this.masterKey(masterSalt),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }
}

function nonce(base: Uint8Array, index: number): Uint8Array<ArrayBuffer> {
  const n = new Uint8Array(12);
  n.set(base, 0);
  new DataView(n.buffer).setUint32(8, index);
  return n;
}

const AAD_MID = new Uint8Array([0]);
const AAD_FINAL = new Uint8Array([1]);

export class FileEncryptor {
  private constructor(
    private key: CryptoKey,
    readonly header: Uint8Array<ArrayBuffer>,
    private baseNonce: Uint8Array,
  ) {}

  static async create(session: EncryptionSession): Promise<FileEncryptor> {
    const fileSalt = random(16);
    const baseNonce = random(8);
    const header = new Uint8Array(HEADER_LEN);
    header.set(MAGIC, 0);
    new DataView(header.buffer).setUint32(8, ENC_CHUNK);
    header.set(session.masterSalt, 12);
    header.set(fileSalt, 28);
    header.set(baseNonce, 44);
    const key = await session.fileKey(session.masterSalt, fileSalt);
    return new FileEncryptor(key, header, baseNonce);
  }

  async encryptChunk(plain: ArrayBuffer, index: number, final: boolean): Promise<ArrayBuffer> {
    return crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce(this.baseNonce, index), additionalData: final ? AAD_FINAL : AAD_MID },
      this.key,
      plain,
    );
  }
}

export class FileDecryptor {
  private constructor(
    private key: CryptoKey,
    private baseNonce: Uint8Array,
    readonly chunkSize: number,
  ) {}

  static async fromHeader(header: Uint8Array, session: EncryptionSession): Promise<FileDecryptor> {
    if (header.length < HEADER_LEN || MAGIC.some((b, i) => header[i] !== b)) {
      throw new Error('This file is not a Local NAS encrypted file.');
    }
    const chunkSize = new DataView(header.buffer, header.byteOffset).getUint32(8);
    const masterSalt = header.slice(12, 28);
    const fileSalt = header.slice(28, 44);
    const baseNonce = header.slice(44, 52);
    return new FileDecryptor(await session.fileKey(masterSalt, fileSalt), baseNonce, chunkSize);
  }

  async decryptChunk(cipher: Uint8Array<ArrayBuffer>, index: number, final: boolean): Promise<Uint8Array<ArrayBuffer>> {
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce(this.baseNonce, index), additionalData: final ? AAD_FINAL : AAD_MID },
        this.key,
        cipher,
      );
      return new Uint8Array(plain);
    } catch {
      throw new WrongPassphraseError();
    }
  }
}

// Turns a stream of encrypted file bytes into plaintext. encSize is the stored
// size, used to know which block is the final one.
export function decryptStream(session: EncryptionSession, encSize: number): TransformStream<Uint8Array, Uint8Array> {
  const parts: Uint8Array[] = [];
  let buffered = 0;
  let decryptor: FileDecryptor | null = null;
  let index = 0;
  let consumed = 0;
  let totalChunks = 0;

  // Removes and returns the first n buffered bytes, copying each byte once.
  function take(n: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      const head = parts[0];
      const need = n - filled;
      if (head.length <= need) {
        out.set(head, filled);
        filled += head.length;
        parts.shift();
      } else {
        out.set(head.subarray(0, need), filled);
        parts[0] = head.subarray(need);
        filled = n;
      }
    }
    buffered -= n;
    return out;
  }

  async function drain(controller: TransformStreamDefaultController<Uint8Array>, flushing: boolean) {
    if (!decryptor) {
      if (buffered < HEADER_LEN) return;
      decryptor = await FileDecryptor.fromHeader(take(HEADER_LEN), session);
      consumed = HEADER_LEN;
      const body = encSize - HEADER_LEN;
      totalChunks = Math.max(1, Math.ceil(body / (decryptor.chunkSize + TAG_LEN)));
    }
    const block = decryptor.chunkSize + TAG_LEN;
    while (index < totalChunks && (buffered >= block || flushing)) {
      const size = Math.min(block, buffered);
      const final = index === totalChunks - 1;
      if (!final && size < block) throw new WrongPassphraseError();
      controller.enqueue(await decryptor.decryptChunk(take(size), index, final));
      consumed += size;
      index++;
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      parts.push(chunk);
      buffered += chunk.length;
      await drain(controller, false);
    },
    async flush(controller) {
      await drain(controller, true);
      if (index !== totalChunks || consumed !== encSize || buffered !== 0) throw new WrongPassphraseError();
    },
  });
}
