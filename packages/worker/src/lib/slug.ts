const ADJECTIVES = [
  "bold", "bright", "calm", "cool", "crisp", "dark", "deep", "fair",
  "fast", "fine", "free", "glad", "gold", "good", "keen", "kind",
  "lean", "live", "long", "mild", "neat", "open", "pale", "pure",
  "rare", "real", "rich", "safe", "slow", "soft", "sure", "tall",
  "thin", "true", "vast", "warm", "wide", "wild", "wise", "blue",
  "dawn", "dusk", "fern", "haze", "jade", "leaf", "lime", "mint",
  "moss", "pine", "rain", "rose", "sage", "sand", "silk", "snow",
  "star", "sun", "tide", "vine", "wave", "zinc",
];

const NOUNS = [
  "arch", "atom", "bark", "beam", "bell", "bird", "bolt", "bone",
  "cape", "cave", "chip", "clay", "code", "coin", "cone", "cork",
  "cove", "crow", "dart", "dawn", "deck", "dome", "dove", "drum",
  "dune", "dust", "edge", "elm", "fawn", "fern", "fire", "fish",
  "flag", "flux", "foam", "fold", "fork", "gate", "gear", "glen",
  "glow", "grid", "harp", "hawk", "helm", "hill", "hive", "horn",
  "isle", "jade", "keel", "knot", "lake", "lamp", "lane", "leaf",
  "link", "loft", "loop", "lynx", "mast", "maze", "mesa", "mill",
  "mint", "moon", "moss", "nest", "node", "oaks", "orb", "palm",
  "path", "peak", "pine", "pond", "port", "reed", "reef", "ring",
  "sage", "sail", "seed", "shore", "spark", "spire", "stem", "stone",
  "tide", "vale", "vault", "wave",
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

export function generateSlug(): string {
  return `${randomFrom(ADJECTIVES)}-${randomFrom(NOUNS)}-${randomHex(4)}`;
}

export function generateVersionId(): string {
  const time = Date.now().toString(36).padStart(9, "0");
  const rand = randomHex(8);
  return `v_${time}_${rand}`;
}

export function generateClaimToken(): string {
  return randomHex(32); // 128-bit hex
}

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;

export function isValidCustomSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug) && !slug.includes("--") && !slug.startsWith("preview-");
}
