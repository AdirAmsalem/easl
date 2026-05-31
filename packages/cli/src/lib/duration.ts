/**
 * Parse a human duration into whole seconds.
 *
 * Accepts a bare number (interpreted as seconds) or a number with a single unit
 * suffix: `s` (seconds), `m` (minutes), `h` (hours), `d` (days), `w` (weeks).
 * Used by `easl share --expires-in 7d`. Throws on anything unparseable or
 * non-positive so the caller surfaces a clear error rather than sending garbage.
 */
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
};

export function parseDurationToSeconds(input: string): number {
  const trimmed = input.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)?$/.exec(trimmed);
  if (!match) {
    throw new Error(
      `Invalid duration "${input}". Use e.g. 3600, 30m, 12h, 7d, 2w.`,
    );
  }
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const seconds = Math.round(value * UNIT_SECONDS[unit]);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Duration must be positive: "${input}"`);
  }
  return seconds;
}
