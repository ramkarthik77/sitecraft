const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Short random id, e.g. "n_k3j9x2ab". */
export function newId(prefix = "n"): string {
  let out = "";
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}
