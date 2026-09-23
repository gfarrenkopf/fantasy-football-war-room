import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption at rest for the ESPN join credential (9.1): AES-256-GCM with a fresh 12-byte IV per
 * seal. `context` is bound in as associated data, so a sealed value copied onto another row (another
 * user's, another league's) fails to open rather than handing over someone else's credential.
 *
 * Sealed form: `v1.<iv>.<tag>.<ciphertext>`, each part base64url. No `config` here; the key is
 * passed in so tests don't need env vars.
 */

const VERSION = "v1";

/** Parses a base64 key, or null unless it's exactly 32 bytes. */
export function parseKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

export function seal(plaintext: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

/** The plaintext, or null if the value was tampered with, sealed under another key or context, or isn't ours. */
export function open(sealed: string, key: Buffer, context: string): string | null {
  const [version, iv, tag, ciphertext, ...rest] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
