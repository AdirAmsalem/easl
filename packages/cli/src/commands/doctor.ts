import { Command } from '@commander-js/extra-typings';
import type { GlobalOpts } from '../lib/client';
import { configExists, listSites } from '../lib/config';
import { buildHelpText } from '../lib/help-text';
import { outputResult } from '../lib/output';
import { createSpinner } from '../lib/spinner';
import { isInteractive } from '../lib/tty';
import { VERSION } from '../lib/version';

type CheckStatus = 'pass' | 'warn' | 'fail';

type CheckResult = {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
};

async function checkCliVersion(): Promise<CheckResult> {
  try {
    const res = await fetch(
      'https://registry.npmjs.org/@easl/cli/latest',
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) {
      return {
        name: 'CLI Version',
        status: 'pass',
        message: `v${VERSION}`,
      };
    }
    const data = (await res.json()) as { version?: string };
    const latest = data.version ?? VERSION;
    if (latest === VERSION) {
      return {
        name: 'CLI Version',
        status: 'pass',
        message: `v${VERSION} (latest)`,
      };
    }
    return {
      name: 'CLI Version',
      status: 'warn',
      message: `v${VERSION} (latest: v${latest})`,
      detail: 'Update with: npm i -g @easl/cli',
    };
  } catch {
    return {
      name: 'CLI Version',
      status: 'pass',
      message: `v${VERSION}`,
    };
  }
}

async function checkApiConnectivity(apiUrl?: string): Promise<CheckResult> {
  const baseUrl = (apiUrl ?? process.env.EASL_API_URL ?? 'https://api.easl.dev').replace(/\/$/, '');
  try {
    const res = await fetch(`${baseUrl}/sites/healthcheck-nonexistent`, {
      signal: AbortSignal.timeout(5000),
    });
    // We expect a 404 — that proves the API is reachable
    if (res.status === 404) {
      return {
        name: 'API',
        status: 'pass',
        message: `${baseUrl} reachable`,
      };
    }
    return {
      name: 'API',
      status: 'pass',
      message: `${baseUrl} reachable (${res.status})`,
    };
  } catch (err) {
    return {
      name: 'API',
      status: 'fail',
      message: `${baseUrl} unreachable`,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkLocalConfig(): CheckResult {
  if (!configExists()) {
    return {
      name: 'Local Config',
      status: 'warn',
      message: 'No sites tracked yet',
      detail: 'Publish something with: easl publish <file>',
    };
  }
  const sites = listSites();
  return {
    name: 'Local Config',
    status: 'pass',
    message: `${sites.length} site${sites.length !== 1 ? 's' : ''} tracked`,
  };
}

export const doctorCommand = new Command('doctor')
  .description('Check CLI version, API connectivity, and local config')
  .addHelpText(
    'after',
    buildHelpText({
      output:
        '  {"ok":true,"checks":[{"name":"...","status":"pass","message":"..."}]}',
      examples: ['easl doctor', 'easl doctor --json'],
    }),
  )
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOpts;
    const checks: CheckResult[] = [];
    const interactive = isInteractive() && !globalOpts.json;

    if (interactive) {
      console.log('\n  easl doctor\n');
    }

    // Check 1: CLI Version
    let spinner = interactive ? createSpinner('Checking CLI version...') : null;
    const versionCheck = await checkCliVersion();
    checks.push(versionCheck);
    if (versionCheck.status === 'warn') {
      spinner?.warn(versionCheck.message);
    } else {
      spinner?.stop(versionCheck.message);
    }

    // Check 2: API Connectivity
    spinner = interactive ? createSpinner('Checking API...') : null;
    const apiCheck = await checkApiConnectivity(globalOpts.apiUrl);
    checks.push(apiCheck);
    if (apiCheck.status === 'fail') {
      spinner?.fail(apiCheck.message);
    } else {
      spinner?.stop(apiCheck.message);
    }

    // Check 3: Local Config
    spinner = interactive ? createSpinner('Checking local config...') : null;
    const configCheck = checkLocalConfig();
    checks.push(configCheck);
    if (configCheck.status === 'warn') {
      spinner?.warn(configCheck.message);
    } else {
      spinner?.stop(configCheck.message);
    }

    const hasFails = checks.some((c) => c.status === 'fail');

    if (!interactive) {
      outputResult({ ok: !hasFails, checks }, globalOpts);
    } else {
      console.log('');
    }

    if (hasFails) {
      process.exit(1);
    }
  });
