import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  addSite,
  configExists,
  getSite,
  listSites,
  readConfig,
  removeSite,
} from './config';

describe('config', () => {
  let tmpDir: string;
  const originalXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `easl-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalXdg) {
      process.env.XDG_CONFIG_HOME = originalXdg;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
  });

  test('readConfig returns empty sites when no config exists', () => {
    const config = readConfig();
    expect(config.sites).toEqual([]);
  });

  test('configExists returns false when no config', () => {
    expect(configExists()).toBe(false);
  });

  test('addSite creates config and adds site', () => {
    addSite({
      slug: 'test-site',
      claimToken: 'tok_abc',
      url: 'https://test-site.easl.dev',
      createdAt: '2026-01-01T00:00:00Z',
    });

    expect(configExists()).toBe(true);
    const sites = listSites();
    expect(sites).toHaveLength(1);
    expect(sites[0].slug).toBe('test-site');
    expect(sites[0].claimToken).toBe('tok_abc');
  });

  test('addSite prepends new sites', () => {
    addSite({
      slug: 'first',
      claimToken: 'tok_1',
      url: 'https://first.easl.dev',
      createdAt: '2026-01-01T00:00:00Z',
    });
    addSite({
      slug: 'second',
      claimToken: 'tok_2',
      url: 'https://second.easl.dev',
      createdAt: '2026-01-02T00:00:00Z',
    });

    const sites = listSites();
    expect(sites).toHaveLength(2);
    expect(sites[0].slug).toBe('second');
    expect(sites[1].slug).toBe('first');
  });

  test('addSite replaces existing slug', () => {
    addSite({
      slug: 'my-site',
      claimToken: 'tok_old',
      url: 'https://my-site.easl.dev',
      createdAt: '2026-01-01T00:00:00Z',
    });
    addSite({
      slug: 'my-site',
      claimToken: 'tok_new',
      url: 'https://my-site.easl.dev',
      createdAt: '2026-01-02T00:00:00Z',
    });

    const sites = listSites();
    expect(sites).toHaveLength(1);
    expect(sites[0].claimToken).toBe('tok_new');
  });

  test('getSite returns site by slug', () => {
    addSite({
      slug: 'target',
      claimToken: 'tok_target',
      url: 'https://target.easl.dev',
      createdAt: '2026-01-01T00:00:00Z',
    });

    const site = getSite('target');
    expect(site).toBeDefined();
    expect(site!.claimToken).toBe('tok_target');
  });

  test('getSite returns undefined for missing slug', () => {
    expect(getSite('nonexistent')).toBeUndefined();
  });

  test('removeSite removes and returns true', () => {
    addSite({
      slug: 'to-remove',
      claimToken: 'tok_rm',
      url: 'https://to-remove.easl.dev',
      createdAt: '2026-01-01T00:00:00Z',
    });

    expect(removeSite('to-remove')).toBe(true);
    expect(listSites()).toHaveLength(0);
  });

  test('removeSite returns false for missing slug', () => {
    expect(removeSite('nonexistent')).toBe(false);
  });

  test('handles optional fields (title, expiresAt)', () => {
    addSite({
      slug: 'titled',
      claimToken: 'tok_t',
      url: 'https://titled.easl.dev',
      createdAt: '2026-01-01T00:00:00Z',
      title: 'My Report',
      expiresAt: '2026-02-01T00:00:00Z',
    });

    const site = getSite('titled');
    expect(site!.title).toBe('My Report');
    expect(site!.expiresAt).toBe('2026-02-01T00:00:00Z');
  });
});
