/**
 * At-rest encryption for aggregator credentials. AES-256-GCM with a random
 * machine-local key protected by Electron OS secure storage. Format: enc1.iv.tag.cipher (base64).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { safeStorage } from 'electron';
import { getDatabase } from '../../db';

const META_KEY = 'aggregator_secret';
const PREFIX = 'enc1.';
const KEY_PREFIX = 'os1.';

function requireSecureStorage(): void {
  if (!safeStorage?.isEncryptionAvailable() ||
      (typeof safeStorage.getSelectedStorageBackend === 'function' &&
        safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new Error('Secure OS storage is unavailable; integration credentials cannot be used safely');
  }
}

function ensureKey(): Buffer {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM license_meta WHERE key = ?').get(META_KEY) as { value: string } | undefined;
  requireSecureStorage();
  if (row?.value?.startsWith(KEY_PREFIX)) {
    const hex = safeStorage.decryptString(Buffer.from(row.value.slice(KEY_PREFIX.length), 'base64'));
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Invalid protected integration key');
    return Buffer.from(hex, 'hex');
  }
  // Wrap the existing key without changing any existing encrypted credentials.
  if (row && !/^[0-9a-f]{64}$/i.test(row.value)) throw new Error('Invalid legacy integration key');
  const key = row ? Buffer.from(row.value, 'hex') : randomBytes(32);
  const protectedKey = KEY_PREFIX + safeStorage.encryptString(key.toString('hex')).toString('base64');
  if (row) {
    db.prepare('UPDATE license_meta SET value = ? WHERE key = ? AND value = ?').run(protectedKey, META_KEY, row.value);
  } else {
    db.prepare('INSERT INTO license_meta (key, value) VALUES (?, ?)').run(META_KEY, protectedKey);
  }
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
  if (!stored.startsWith(PREFIX)) return null; // Never use unprotected legacy credentials; re-enter them.
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
