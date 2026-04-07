#!/usr/bin/env node
import { Command } from '@commander-js/extra-typings';
import pc from 'picocolors';
import { setupCliExitHandler } from './lib/cli-exit';
import { completionCommand } from './commands/completion';
import { deleteCommand } from './commands/delete';
import { doctorCommand } from './commands/doctor';
import { getCommand } from './commands/get';
import { listCommand } from './commands/list';
import { openCommand } from './commands/open';
import { publishCommand } from './commands/publish';
import { outputError, errorMessage } from './lib/output';
import { checkForUpdates } from './lib/update-check';
import { PACKAGE_NAME, VERSION } from './lib/version';

setupCliExitHandler();

const program = new Command()
  .name('easl')
  .description('easl CLI — instant hosting from your terminal')
  .configureHelp({
    showGlobalOptions: true,
    styleTitle: (str) => pc.gray(str),
  })
  .configureOutput({
    writeErr: (str) => {
      process.stderr.write(str.replace(/^error:/, () => pc.red('error:')));
    },
  })
  .helpCommand(true)
  .version(
    `${PACKAGE_NAME} v${VERSION}`,
    '-v, --version',
    'Output the current version',
  )
  .option('--json', 'Force JSON output')
  .option('-q, --quiet', 'Suppress spinners and status output (implies --json)')
  .option('--api-url <url>', 'API URL (overrides EASL_API_URL)')
  .hook('preAction', (_thisCommand, actionCommand) => {
    if (actionCommand.optsWithGlobals().quiet) {
      _thisCommand.setOptionValue('json', true);
    }
  })
  .hook('postAction', async (_thisCommand, actionCommand) => {
    const opts = actionCommand.optsWithGlobals();
    if (!opts.quiet && !opts.json && process.stdout.isTTY) {
      await checkForUpdates();
    }
  })
  .addHelpText(
    'after',
    `
${pc.gray('Examples:')}
  - Publish a file

    ${pc.blue('$ easl publish report.md')}

  - Publish from stdin

    ${pc.blue('$ cat data.csv | easl publish --type csv')}

  - List published sites

    ${pc.blue('$ easl list')}
`,
  )
  .action(() => {
    program.help();
  })
  .addCommand(publishCommand)
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(deleteCommand)
  .addCommand(openCommand)
  .addCommand(doctorCommand)
  .addCommand(completionCommand);

program
  .parseAsync()
  .catch((err) => {
    outputError({
      message: errorMessage(err, 'An unexpected error occurred'),
      code: 'unexpected_error',
    });
  });
