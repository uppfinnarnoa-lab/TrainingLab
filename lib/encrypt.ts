// AES-256-GCM symmetric encryption for secrets stored in the database.
// Key is derived from AUTH_SECRET — never stored in the database.
// Format: iv_hex:authTag_hex:ciphertext_hex

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET not set — cannot encrypt/decrypt secrets");
  // Derive a 32-byte key from AUTH_SECRET using SHA-256
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    // Legacy plaintext — return as-is (handles migration of existing stored values)
    return ciphertext;
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

// Encrypt only if the value looks like plaintext (not already encrypted).
// Format: 24-char hex iv : 32-char hex authTag : N-char hex ciphertext
const ENCRYPTED_RE = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;

export function encryptIfNeeded(value: string | null | undefined): string | null {
  if (!value) return null;
  if (ENCRYPTED_RE.test(value)) return value; // already encrypted
  return encrypt(value);
}

// Decrypt safely — returns null on failure
export function safeDecrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  try { return decrypt(value); } catch { return null; }
}
