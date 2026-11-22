/**
 * CareerOS — Secure Local Token Encryption Service
 * Protects OAuth tokens at rest using AES-256-GCM authenticated encryption.
 * Provides machine/user-bound key derivation and seamless migration for legacy plaintext tokens.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_DIR = path.resolve(__dirname, '../../data/.oauth_tokens');
const KEY_PATH = path.join(TOKEN_DIR, '.master_secret.key');

/**
 * Derives a machine-and-user-bound encryption key.
 * Combines an OS-bound salt, user profile identity, and a locally generated 256-bit secret.
 */
function getOrCreateMasterKey() {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }

  let secretBytes;
  if (fs.existsSync(KEY_PATH)) {
    secretBytes = fs.readFileSync(KEY_PATH);
  } else {
    // Generate 32 bytes of cryptographically random secret
    secretBytes = crypto.randomBytes(32);
    fs.writeFileSync(KEY_PATH, secretBytes, { mode: 0o600 });
  }

  // Bind key to current OS user and machine identifier to prevent porting between environments
  const userInfo = os.userInfo();
  const bindingData = `${userInfo.username}:${os.hostname()}:${userInfo.homedir}`;
  const salt = crypto.createHash('sha256').update(bindingData).digest();

  // PBKDF2 with 100,000 iterations to generate a 256-bit AES key
  return crypto.pbkdf2Sync(secretBytes, salt, 100000, 32, 'sha256');
}

/**
 * Encrypts a JavaScript token object into an authenticated AES-256-GCM payload.
 */
export function encryptTokenPayload(tokens) {
  if (!tokens || typeof tokens !== 'object') {
    throw new Error('Invalid token payload: expected an object.');
  }

  const key = getOrCreateMasterKey();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = JSON.stringify(tokens);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: true,
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
    createdAt: Date.now()
  };
}

/**
 * Decrypts a stored token payload.
 * Seamlessly detects legacy unencrypted tokens and returns { tokens, needsMigration: true }.
 */
export function decryptTokenPayload(stored) {
  if (!stored) return null;

  let payload = stored;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }

  // Migration detection: If file contains plain access_token without encrypted flag
  if (!payload.encrypted) {
    if (payload.access_token || payload.refresh_token) {
      return {
        tokens: payload,
        needsMigration: true
      };
    }
    return null;
  }

  // Authenticated decryption
  try {
    const key = getOrCreateMasterKey();
    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');
    const ciphertext = Buffer.from(payload.ciphertext, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const tokens = JSON.parse(decrypted.toString('utf-8'));

    return {
      tokens,
      needsMigration: false
    };
  } catch (err) {
    console.error('[OAuth Security] Failed to decrypt OAuth tokens:', err.message);
    return null;
  }
}

/**
 * Securely overwrites and removes sensitive token files.
 */
export function secureWipeFile(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      const randomData = crypto.randomBytes(stats.size);
      fs.writeFileSync(filePath, randomData);
      fs.unlinkSync(filePath);
      return true;
    } catch (err) {
      console.warn(`[OAuth Security] Could not secure-wipe file ${filePath}: ${err.message}`);
      try {
        fs.unlinkSync(filePath);
      } catch {}
      return false;
    }
  }
  return false;
}
