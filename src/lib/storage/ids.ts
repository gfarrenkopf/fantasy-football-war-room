/**
 * A random 128-bit id, hex-encoded.
 *
 * Not crypto.randomUUID(): browsers only expose that in secure contexts, and self-hosters
 * commonly open the app over plain http://<server-ip>:3000. getRandomValues() works everywhere.
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const nowIso = () => new Date().toISOString();
