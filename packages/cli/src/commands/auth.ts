import { Command } from '@commander-js/extra-typings';
import pc from 'picocolors';
import { type GlobalOpts, apiRequest } from '../lib/client';
import { isAuthenticated } from '../lib/credentials';
import { buildHelpText } from '../lib/help-text';
import { outputError, outputResult } from '../lib/output';
import { withSpinner } from '../lib/spinner';
import { renderTable } from '../lib/table';
import { isInteractive } from '../lib/tty';

interface ApiKeyMeta {
  id: string;
  name?: string | null;
  start?: string | null;
  prefix?: string | null;
  enabled?: boolean;
  createdAt?: string | null;
  expiresAt?: string | null;
  lastRequest?: string | null;
}

interface ListKeysResponse {
  apiKeys?: ApiKeyMeta[];
}

function requireAuth(globalOpts: GlobalOpts): void {
  if (!isAuthenticated(globalOpts.apiKey)) {
    outputError(
      {
        message:
          'Not logged in. Run `easl login` or set EASL_API_KEY (or pass --api-key).',
        code: 'auth_error',
      },
      globalOpts,
    );
  }
}

const listKeysCommand = new Command('list-keys')
  .description('List your API keys (metadata only — never the secret)')
  .addHelpText(
    'after',
    buildHelpText({
      output: '  {"apiKeys":[{"id":"...","name":"...","start":"easl_...","createdAt":"..."}]}',
      errorCodes: ['auth_error'],
      examples: ['easl auth list-keys', 'easl auth list-keys --json'],
    }),
  )
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOpts;
    requireAuth(globalOpts);

    const res = await withSpinner(
      'Fetching API keys...',
      () => apiRequest<ListKeysResponse>('GET', '/auth/api-key/list', globalOpts),
      'auth_error',
      globalOpts,
    );

    const keys = res.apiKeys ?? [];

    if (globalOpts.json || !isInteractive()) {
      outputResult({ apiKeys: keys }, globalOpts);
      return;
    }

    if (keys.length === 0) {
      console.log('\n  No API keys. Create one by signing in: easl login\n');
      return;
    }

    const rows = keys.map((k) => [
      k.id,
      k.name ?? '',
      k.start ? `${k.start}…` : '',
      k.enabled === false ? 'disabled' : 'active',
      k.createdAt ? new Date(k.createdAt).toLocaleDateString() : '',
    ]);

    console.log('');
    console.log(renderTable(['ID', 'Name', 'Key', 'Status', 'Created'], rows));
    console.log('');
  });

const revokeKeyCommand = new Command('revoke')
  .description('Revoke (delete) an API key by id')
  .argument('<id>', 'API key id (from `easl auth list-keys`)')
  .addHelpText(
    'after',
    buildHelpText({
      context:
        'Permanently revokes the key server-side. A revoked key can no longer\nauthenticate. Find ids with `easl auth list-keys`.',
      output: '  {"success":true,"id":"..."}',
      errorCodes: ['auth_error'],
      examples: ['easl auth revoke abc123'],
    }),
  )
  .action(async (id, _opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOpts;
    requireAuth(globalOpts);

    await withSpinner(
      'Revoking API key...',
      () =>
        apiRequest('POST', '/auth/api-key/delete', globalOpts, { keyId: id }),
      'auth_error',
      globalOpts,
    );

    if (globalOpts.json || !isInteractive()) {
      outputResult({ success: true, id }, globalOpts);
    } else {
      console.log(`\n  Revoked API key ${pc.bold(id)}\n`);
    }
  });

export const authCommand = new Command('auth')
  .description('Manage API keys for your easl account')
  .addHelpText(
    'after',
    buildHelpText({
      context:
        'Subcommands manage the API keys tied to your account.\nSign in with `easl login`; sign out with `easl logout`.',
      examples: ['easl auth list-keys', 'easl auth revoke <id>'],
    }),
  )
  .addCommand(listKeysCommand)
  .addCommand(revokeKeyCommand);
