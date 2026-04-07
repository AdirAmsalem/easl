export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

export const isUnicodeSupported: boolean = (() => {
  if (process.platform === 'win32') {
    return (
      Boolean(process.env.WT_SESSION) || process.env.TERM_PROGRAM === 'vscode'
    );
  }
  return process.env.TERM !== 'linux';
})();
