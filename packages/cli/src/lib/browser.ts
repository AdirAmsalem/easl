import { exec } from 'node:child_process';

export function openInBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const cmd =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'start ""'
          : 'xdg-open';

    exec(`${cmd} ${JSON.stringify(url)}`, (err) => {
      resolve(!err);
    });
  });
}
