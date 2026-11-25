/**
 * At-rest encryption for aggregator credentials. AES-256-GCM with a random
 * machine-local key persisted in license_meta. Format: enc1.iv.tag.cipher (base64).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getDatabase } from '../../db';

const META_KEY = 'aggregator_secret';
const PREFIX = 'enc1.';

function ensureKey(): Buffer {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM license_meta WHERE key = ?').get(META_KEY) as { value: string } | undefined;
  if (row?.value) return Buffer.from(row.value, 'hex');
  const key = randomBytes(32);
  db.prepare('INSERT INTO license_meta (key, value) VALUES (?, ?)').run(META_KEY, key.toString('hex'));
  return key;
}

export function encryptConfigValue(plain: string | null): string | null {
  if (!plain) return null;
  const key = ensureKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptConfigValue(stored: string | null): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext tolerance
  const parts = stored.slice(PREFIX.length).split('.');
  if (parts.length !== 3) return null;
  const [ivB64, tagB64, dataB64] = parts;
  try {
    const key = ensureKey();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
