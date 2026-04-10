import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { getConfigDir } from './config';
import { IS_BINARY, VERSION } from './version';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_FILE = 'update-check.json';

type CacheData = {
  latest: string;
  checkedAt: number;
};

function getCachePath(): string {
  return join(getConfigDir(), CACHE_FILE);
}

function readCache(): CacheData | null {
  try {
    const path = getCachePath();
    if (!existsSync(path)) return null;
    const data = JSON.parse(readFileSync(path, 'utf8')) as CacheData;
    if (Date.now() - data.checkedAt > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(latest: string): void {
  try {
    const dir = getConfigDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      getCachePath(),
      JSON.stringify({ latest, checkedAt: Date.now() } satisfies CacheData),
    );
  } catch {
    // ignore — cache is best-effort
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch('https://registry.npmjs.org/@easl/cli/latest', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function detectInstallCommand(): string {
  if (IS_BINARY) {
    return 'curl -fsSL https://easl.dev/install.sh | sh';
  }
  const agent = process.env.npm_config_user_agent ?? '';
  if (agent.startsWith('pnpm')) return 'pnpm add -g @easl/cli';
  if (agent.startsWith('yarn')) return 'yarn global add @easl/cli';
  if (agent.startsWith('bun')) return 'bun add -g @easl/cli';
  return 'npm i -g @easl/cli';
}

export async function checkForUpdates(): Promise<void> {
  // Check cache first
  const cached = readCache();
  const latest = cached?.latest ?? (await fetchLatestVersion());

  if (!latest) return;

  // Update cache if we fetched fresh
  if (!cached) writeCache(latest);

  if (latest === VERSION) return;

  const cmd = detectInstallCommand();
  process.stderr.write(
    `\n  ${pc.yellow('Update available')} ${pc.gray(VERSION)} ${pc.gray('→')} ${pc.green(latest)}\n  Run ${pc.cyan(cmd)} to update\n\n`,
  );
}
