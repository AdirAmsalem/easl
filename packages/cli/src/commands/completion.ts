import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Argument, Command } from '@commander-js/extra-typings';
import {
  collectCommandTree,
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
} from '../lib/completion';
import { buildHelpText } from '../lib/help-text';
import { isInteractive } from '../lib/tty';

const SHELLS = ['bash', 'zsh', 'fish'] as const;
type Shell = (typeof SHELLS)[number];

const MARKER = '# easl shell completion';

function detectShell(): Shell | undefined {
  const shell = process.env.SHELL;
  if (shell) {
    const name = basename(shell);
    if (name === 'bash') return 'bash';
    if (name === 'zsh') return 'zsh';
    if (name === 'fish') return 'fish';
  }
  return undefined;
}

function getProfilePath(shell: 'bash' | 'zsh'): string {
  switch (shell) {
    case 'bash':
      return process.platform === 'darwin'
        ? join(homedir(), '.bash_profile')
        : join(homedir(), '.bashrc');
    case 'zsh':
      return join(homedir(), '.zshrc');
  }
}

function generateScript(
  shell: Shell,
  tree: ReturnType<typeof collectCommandTree>,
): string {
  switch (shell) {
    case 'bash':
      return generateBashCompletion(tree);
    case 'zsh':
      return generateZshCompletion(tree);
    case 'fish':
      return generateFishCompletion(tree);
  }
}

function installCompletion(shell: Shell, script: string): void {
  switch (shell) {
    case 'zsh': {
      const completionDir = join(homedir(), '.zsh', 'completions');
      if (!existsSync(completionDir)) {
        mkdirSync(completionDir, { recursive: true });
      }
      const filePath = join(completionDir, '_easl');
      writeFileSync(filePath, `${script}\n`);
      console.log(`Completions written to ${filePath}`);

      const profilePath = getProfilePath(shell);
      let needsFpath = true;
      if (existsSync(profilePath)) {
        const content = readFileSync(profilePath, 'utf8');
        if (content.includes(completionDir)) needsFpath = false;
      }

      if (needsFpath) {
        const fpathLine = `${MARKER}\nfpath=(${completionDir} $fpath)\n`;
        const existing = existsSync(profilePath)
          ? readFileSync(profilePath, 'utf8')
          : '';
        const compinitMatch = existing.match(/^.*compinit.*$/m);
        if (compinitMatch) {
          const idx = existing.indexOf(compinitMatch[0]);
          const before = existing.slice(0, idx);
          const after = existing.slice(idx);
          writeFileSync(profilePath, `${before}${fpathLine}\n${after}`);
        } else {
          writeFileSync(
            profilePath,
            `\n${fpathLine}autoload -Uz compinit && compinit\n`,
            { flag: 'a' },
          );
        }
        console.log(`Added completion path to ${profilePath}`);
      }
      console.log('Restart your shell to activate completions.');
      return;
    }

    case 'fish': {
      const completionDir = join(homedir(), '.config', 'fish', 'completions');
      if (!existsSync(completionDir)) {
        mkdirSync(completionDir, { recursive: true });
      }
      const filePath = join(completionDir, 'easl.fish');
      writeFileSync(filePath, `${script}\n`);
      console.log(`Completions written to ${filePath}`);
      console.log('Completions will be available in new fish sessions.');
      return;
    }

    case 'bash': {
      const profilePath = getProfilePath(shell);
      const snippet = `\n${MARKER}\neval "$(easl completion ${shell})"\n`;

      if (existsSync(profilePath)) {
        const content = readFileSync(profilePath, 'utf8');
        if (content.includes(MARKER)) {
          console.log(`Completions already installed in ${profilePath}`);
          return;
        }
      }

      const dir = dirname(profilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(profilePath, snippet, { flag: 'a' });
      console.log(`Completions added to ${profilePath}`);
      console.log('Restart your shell to activate completions.');
      return;
    }
  }
}

export const completionCommand = new Command('completion')
  .description('Generate shell completion script')
  .addArgument(new Argument('[shell]', 'Shell type').choices(SHELLS))
  .option('--install', 'Install completions into your shell profile')
  .addHelpText(
    'after',
    buildHelpText({
      context: `Outputs a completion script for the given shell. The shell is auto-detected
from $SHELL when not specified.

Quick setup:
  easl completion --install

Manual setup:

  Bash (add to ~/.bashrc):
    eval "$(easl completion bash)"

  Zsh (add to ~/.zshrc):
    eval "$(easl completion zsh)"

  Fish:
    easl completion fish > ~/.config/fish/completions/easl.fish`,
      examples: [
        'easl completion --install',
        'easl completion bash',
        'easl completion zsh',
        'eval "$(easl completion bash)"',
      ],
    }),
  )
  .action(async (explicitShell, opts, cmd) => {
    let shell: Shell;
    if (explicitShell) {
      shell = explicitShell as Shell;
    } else {
      const detected = detectShell();
      if (detected) {
        shell = detected;
      } else if (!opts.install) {
        cmd.help();
        return;
      } else {
        process.stderr.write(
          'error: could not detect shell. Pass the shell name explicitly.\n',
        );
        process.exit(1);
      }
    }

    const root = cmd.parent;
    if (!root) {
      throw new Error('completion command must be registered under a parent');
    }
    const tree = collectCommandTree(root as Command);
    const script = generateScript(shell, tree);

    if (opts.install) {
      installCompletion(shell, script);
      return;
    }

    if (!explicitShell && isInteractive()) {
      cmd.help();
      return;
    }

    console.log(script);
  });
