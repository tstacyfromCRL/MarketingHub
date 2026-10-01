import crypto from 'node:crypto';
import { config } from './config';

function key(): Buffer {
  if (config.ENCRYPTION_KEY) {
    const k = Buffer.from(config.ENCRYPTION_KEY, 'base64');
    if (k.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64 encoded');
    return k;
  }
  if (config.NODE_ENV === 'production') throw new Error('ENCRYPTION_KEY is required in production');
  return crypto.createHash('sha256').update(config.JWT_SECRET).digest();
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
