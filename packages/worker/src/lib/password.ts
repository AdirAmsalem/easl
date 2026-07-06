import { b64urlDecode, b64urlEncode, constantTimeEqual } from "./crypto";

// Cloudflare Workers caps PBKDF2 at 100k iterations; higher throws at runtime.
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LEN = 32; // bytes (256-bit derived key)
const PBKDF2_SALT_LEN = 16; // bytes

/**
 * Hash format: `pbkdf2$<iters>$<salt-b64url>$<hash-b64url>`.
 * Salt and hash are base64url without padding.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_LEN));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iters = Number(parts[1]);
  if (!Number.isInteger(iters) || iters < 1000 || iters > 10_000_000) return false;
  const salt = b64urlDecode(parts[2]);
  const expected = b64urlDecode(parts[3]);
  if (!salt || !expected) return false;
  const actual = await derive(password, salt, iters);
  return constantTimeEqual(b64urlEncode(actual), b64urlEncode(expected));
}

async function derive(password: string, salt: Uint8Array, iters: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iters },
    key,
    PBKDF2_KEY_LEN * 8,
  );
  return new Uint8Array(bits);
}

const WORDS = [
  "bold", "bright", "calm", "cool", "crisp", "dark", "deep", "fair",
  "fast", "fine", "free", "glad", "gold", "good", "keen", "kind",
  "lean", "live", "long", "mild", "neat", "open", "pale", "pure",
  "rare", "real", "rich", "safe", "slow", "soft", "sure", "tall",
  "thin", "true", "vast", "warm", "wide", "wild", "wise", "blue",
  "dawn", "dusk", "fern", "haze", "jade", "leaf", "lime", "mint",
  "moss", "pine", "rain", "rose", "sage", "sand", "silk", "snow",
  "star", "tide", "vine", "wave", "zinc", "arch", "atom", "bark",
  "beam", "bell", "bird", "bolt", "bone", "cape", "cave", "chip",
  "clay", "code", "coin", "cone", "cork", "cove", "crow", "dart",
  "deck", "dome", "dove", "drum", "dune", "dust", "edge", "fawn",
  "fire", "fish", "flag", "flux", "foam", "fold", "fork", "gate",
  "gear", "glen", "glow", "grid", "harp", "hawk", "helm", "hill",
  "hive", "horn", "isle", "keel", "knot", "lake", "lamp", "lane",
  "link", "loft", "loop", "lynx", "mast", "maze", "mesa", "mill",
  "moon", "nest", "node", "oaks", "palm", "path", "peak", "pond",
  "port", "reed", "reef", "ring", "sail", "seed", "spark", "spire",
  "stem", "stone", "vale", "vault", "river", "ridge", "creek", "brook",
];

/**
 * Generate a memorable random password: 4 words + 4 digits.
 * Entropy ~ log2(WORDS.length^4 * 10_000) ≈ 41 bits with current wordlist.
 */
export function generatePassword(): string {
  const w: string[] = [];
  const idx = new Uint32Array(4);
  crypto.getRandomValues(idx);
  for (let i = 0; i < 4; i++) w.push(WORDS[idx[i] % WORDS.length]);
  const digits = (crypto.getRandomValues(new Uint16Array(1))[0] % 10_000)
    .toString()
    .padStart(4, "0");
  return `${w.join("-")}-${digits}`;
}
