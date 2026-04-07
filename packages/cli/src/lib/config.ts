import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface TrackedSite {
  slug: string;
  claimToken: string;
  url: string;
  createdAt: string;
  title?: string;
  expiresAt?: string;
}

interface ConfigFile {
  sites: TrackedSite[];
}

export function getConfigDir(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, 'easl');
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'easl');
  }
  return join(homedir(), '.config', 'easl');
}

function getConfigPath(): string {
  return join(getConfigDir(), 'sites.json');
}

export function readConfig(): ConfigFile {
  try {
    const data = JSON.parse(readFileSync(getConfigPath(), 'utf-8'));
    return { sites: Array.isArray(data.sites) ? data.sites : [] };
  } catch {
    return { sites: [] };
  }
}

function writeConfig(config: ConfigFile): void {
  const configDir = getConfigDir();
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function addSite(site: TrackedSite): void {
  const config = readConfig();
  // Replace if slug already exists
  const idx = config.sites.findIndex((s) => s.slug === site.slug);
  if (idx >= 0) {
    config.sites[idx] = site;
  } else {
    config.sites.unshift(site);
  }
  writeConfig(config);
}

export function removeSite(slug: string): boolean {
  const config = readConfig();
  const idx = config.sites.findIndex((s) => s.slug === slug);
  if (idx < 0) return false;
  config.sites.splice(idx, 1);
  writeConfig(config);
  return true;
}

export function getSite(slug: string): TrackedSite | undefined {
  return readConfig().sites.find((s) => s.slug === slug);
}

export function listSites(): TrackedSite[] {
  return readConfig().sites;
}

export function configExists(): boolean {
  return existsSync(getConfigPath());
}
